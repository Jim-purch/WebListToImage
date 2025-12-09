let detectedLists = [];
let currentHighlight = null;

function scanForLists() {
    detectedLists = [];
    // Basic heuristic: Find parents with multiple children of the same tag
    const allElements = document.body.querySelectorAll('*');

    allElements.forEach(el => {
        const children = Array.from(el.children);
        if (children.length < 2) return;

        const tagGroups = {};
        children.forEach(child => {
            const tag = child.tagName;
            if (!tagGroups[tag]) tagGroups[tag] = [];
            tagGroups[tag].push(child);
        });

        for (const [tag, items] of Object.entries(tagGroups)) {
            if (items.length >= 3) {
                let sampleText = "";
                for (let item of items) {
                    if (item.innerText && item.innerText.trim().length > 0) {
                        sampleText = item.innerText.trim().substring(0, 50).replace(/\n/g, ' ');
                        break;
                    }
                }
                if (!sampleText) sampleText = "[No Text]";

                detectedLists.push({
                    id: detectedLists.length,
                    parent: el,
                    items: items,
                    tagName: tag,
                    sampleText: sampleText
                });
            }
        }
    });

    return detectedLists.map(l => ({
        id: l.id,
        count: l.items.length,
        tagName: l.tagName,
        sampleText: l.sampleText
    }));
}

function highlightList(id) {
    if (currentHighlight !== null) {
        currentHighlight.items.forEach(item => {
            item.style.outline = '';
        });
    }

    const list = detectedLists.find(l => l.id === id);
    if (!list) return;

    currentHighlight = list;

    list.items.forEach(item => {
        item.style.outline = '2px dashed red';
    });

    if (list.items.length > 0) {
        list.items[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function clearHighlight() {
    if (currentHighlight !== null) {
        currentHighlight.items.forEach(item => {
            item.style.outline = '';
        });
        currentHighlight = null;
    }
}

// Prepare item for capture: scroll to it and return coordinates
async function prepareItem(listId, index) {
    const list = detectedLists.find(l => l.id === listId);
    if (!list || !list.items[index]) throw new Error("Item not found");

    const item = list.items[index];

    // Scroll into view
    item.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });

    // Wait for scroll/render (short delay)
    await new Promise(r => setTimeout(r, 200));

    // Get coordinates relative to viewport
    const rect = item.getBoundingClientRect();

    // Get text for CSV
    const text = (item.innerText || "").replace(/"/g, '""').replace(/\n/g, ' ');

    return {
        rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
        },
        devicePixelRatio: window.devicePixelRatio || 1,
        text: text,
        isComplete: index >= list.items.length - 1
    };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SCAN_LISTS") {
        const lists = scanForLists();
        sendResponse({ lists });
    } else if (request.action === "HIGHLIGHT") {
        highlightList(request.id);
        sendResponse({ success: true });
    } else if (request.action === "CLEAR_HIGHLIGHT") {
        clearHighlight();
        sendResponse({ success: true });
    } else if (request.action === "PREPARE_ITEM") {
        prepareItem(request.listId, request.index).then(data => {
            sendResponse({ success: true, data });
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true; // Async response
    } else if (request.action === "GET_LIST_INFO") {
        const list = detectedLists.find(l => l.id === request.id);
        if (list) {
            sendResponse({ success: true, count: list.items.length });
        } else {
            sendResponse({ success: false, error: "List not found" });
        }
    }
});
