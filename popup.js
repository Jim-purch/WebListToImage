let selectedListId = null;

document.addEventListener('DOMContentLoaded', () => {
    const scanBtn = document.getElementById('scanBtn');
    const exportBtn = document.getElementById('exportBtn');
    const listContainer = document.getElementById('listContainer');
    const statusDiv = document.getElementById('status');

    scanBtn.addEventListener('click', () => {
        statusDiv.textContent = "Scanning...";
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "SCAN_LISTS" }, (response) => {
                    if (chrome.runtime.lastError) {
                        statusDiv.textContent = "Error: Please refresh the page.";
                        console.error(chrome.runtime.lastError);
                        return;
                    }
                    if (response && response.lists) {
                        renderLists(response.lists);
                        statusDiv.textContent = `Found ${response.lists.length} lists.`;
                    } else {
                        statusDiv.textContent = "No lists found.";
                    }
                });
            }
        });
    });

    exportBtn.addEventListener('click', async () => {
        if (selectedListId === null) return;

        statusDiv.textContent = "Initializing export...";
        exportBtn.disabled = true;

        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tabId = tabs[0].id;

            // Get list info
            const info = await sendMessageAsync(tabId, { action: "GET_LIST_INFO", id: selectedListId });
            if (!info.success) throw new Error(info.error);

            // Clear highlights before capturing
            await sendMessageAsync(tabId, { action: "CLEAR_HIGHLIGHT" });

            const count = info.count;
            const zip = new JSZip();
            const folder = zip.folder("images");
            let csvContent = "\uFEFFIndex,Text,ImageFile\n";

            for (let i = 0; i < count; i++) {
                statusDiv.textContent = `Processing item ${i + 1} / ${count}...`;

                // 1. Prepare item (scroll, get rect)
                const prep = await sendMessageAsync(tabId, { action: "PREPARE_ITEM", listId: selectedListId, index: i });
                if (!prep.success) {
                    console.error("Error preparing item", i, prep.error);
                    csvContent += `${i + 1},"ERROR","ERROR"\n`;
                    continue;
                }

                const { rect, devicePixelRatio, text } = prep.data;

                // 2. Capture visible tab with retry
                let dataUrl;
                try {
                    dataUrl = await captureTabWithRetry();
                } catch (err) {
                    console.error("Failed to capture after retries", i, err);
                    csvContent += `${i + 1},"ERROR","ERROR_CAPTURE"\n`;
                    continue;
                }

                // 3. Crop image
                const croppedDataUrl = await cropImage(dataUrl, rect, devicePixelRatio);

                // 4. Add to ZIP
                const filename = `image_${i + 1}.jpg`;
                const base64Data = croppedDataUrl.split(',')[1];
                folder.file(filename, base64Data, { base64: true });
                csvContent += `${i + 1},"${text}","images/${filename}"\n`;

                // Delay to prevent hitting quota (max 2 calls per second usually)
                await new Promise(r => setTimeout(r, 200));
            }

            // 5. Generate and Download
            statusDiv.textContent = "Generating ZIP...";
            zip.file("data.csv", csvContent);
            const content = await zip.generateAsync({ type: "blob" });

            const url = URL.createObjectURL(content);

            // Use chrome.downloads to prompt usage of 'Save As'
            chrome.downloads.download({
                url: url,
                filename: "list_export.zip",
                saveAs: true
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error("Download failed", chrome.runtime.lastError);
                    statusDiv.textContent = "Download failed: " + chrome.runtime.lastError.message;
                } else {
                    // Revoke URL after a delay or just let it stay (browser handles it mostly)
                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                }
            });

            statusDiv.textContent = "Export complete!";

        } catch (e) {
            console.error(e);
            statusDiv.textContent = "Error: " + e.message;
        } finally {
            exportBtn.disabled = false;
        }
    });

    function renderLists(lists) {
        listContainer.innerHTML = '';
        if (lists.length === 0) {
            listContainer.innerHTML = '<p class="placeholder">No lists found.</p>';
            return;
        }

        lists.forEach(list => {
            const div = document.createElement('div');
            div.className = 'list-item';
            div.innerHTML = `
                <h3>${list.tagName} List <span class="count">${list.count} items</span></h3>
                <p>${list.sampleText}</p>
            `;
            div.addEventListener('click', () => {
                selectList(div, list.id);
            });
            listContainer.appendChild(div);
        });
    }

    function selectList(element, id) {
        const current = document.querySelector('.list-item.selected');
        if (current) current.classList.remove('selected');
        element.classList.add('selected');

        selectedListId = id;
        exportBtn.disabled = false;

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "HIGHLIGHT", id: id });
            }
        });
    }
});

function sendMessageAsync(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
}

function cropImage(dataUrl, rect, scale) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            // Adjust rect by pixel ratio
            const x = rect.x * scale;
            const y = rect.y * scale;
            const width = rect.width * scale;
            const height = rect.height * scale;

            // Handle potential boundary issues

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

            resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

function captureTabWithRetry(retries = 3) {
    return new Promise((resolve, reject) => {
        function attempt(n) {
            chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 90 }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    const msg = chrome.runtime.lastError.message;

                    if (n > 0 && msg.includes("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND")) {
                        console.warn(`Quota exceeded, waiting... (attempt ${n})`);
                        // Wait longer (1.5s) and retry
                        setTimeout(() => attempt(n - 1), 1500);
                    } else if (n > 0) {
                        console.warn(`Capture error: ${msg}, retrying... (attempt ${n})`);
                        // Other transient errors?
                        setTimeout(() => attempt(n - 1), 500);
                    } else {
                        reject(new Error(msg));
                    }
                } else {
                    resolve(dataUrl);
                }
            });
        }
        attempt(retries);
    });
}
