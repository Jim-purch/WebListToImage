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
    })).sort((a, b) => b.count - a.count);
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

// Extract comprehensive data from an element including hover-related information
function extractItemData(element) {
    const data = {};

    // 1. Visible text content
    const text = (element.innerText || "").replace(/"/g, '""').replace(/\n/g, ' ').trim();
    data.text = text;

    // 2. Title attribute (tooltip on hover)
    if (element.title) {
        data.title = element.title.replace(/"/g, '""').replace(/\n/g, ' ').trim();
    }

    // 3. All data-* attributes
    if (element.dataset) {
        for (const [key, value] of Object.entries(element.dataset)) {
            if (value) {
                data[`data_${key}`] = value.replace(/"/g, '""').replace(/\n/g, ' ').trim();
            }
        }
    }

    // 4. Aria-label (accessibility label, often shown in tooltips)
    if (element.getAttribute('aria-label')) {
        data.ariaLabel = element.getAttribute('aria-label').replace(/"/g, '""').replace(/\n/g, ' ').trim();
    }

    // 5. Search for title attributes in child elements
    const childTitles = [];
    element.querySelectorAll('[title]').forEach(el => {
        if (el.title && el.title.trim()) {
            childTitles.push(el.title.replace(/"/g, '""').replace(/\n/g, ' ').trim());
        }
    });
    if (childTitles.length > 0) {
        data.childTitles = childTitles.join(' | ');
    }

    // 6. Extract data-* from child elements
    const childDataAttrs = {};
    element.querySelectorAll('*').forEach(el => {
        if (el.dataset) {
            for (const [key, value] of Object.entries(el.dataset)) {
                if (value && !childDataAttrs[key]) {
                    childDataAttrs[key] = value.replace(/"/g, '""').replace(/\n/g, ' ').trim();
                }
            }
        }
    });
    for (const [key, value] of Object.entries(childDataAttrs)) {
        if (!data[`data_${key}`]) {
            data[`data_${key}`] = value;
        }
    }

    // 7. Images: alt text and src
    const images = element.querySelectorAll('img');
    const imgAlts = [];
    const imgSrcs = [];
    images.forEach(img => {
        if (img.alt && img.alt.trim()) {
            imgAlts.push(img.alt.replace(/"/g, '""').trim());
        }
        if (img.src) {
            imgSrcs.push(img.src);
        }
    });
    if (imgAlts.length > 0) {
        data.imageAlts = imgAlts.join(' | ');
    }
    if (imgSrcs.length > 0) {
        data.imageSrcs = imgSrcs.join(' | ');
    }

    // 8. Links: href and title
    const links = element.querySelectorAll('a[href]');
    const hrefs = [];
    const linkTitles = [];
    links.forEach(link => {
        if (link.href) {
            hrefs.push(link.href);
        }
        if (link.title && link.title.trim()) {
            linkTitles.push(link.title.replace(/"/g, '""').trim());
        }
    });
    if (hrefs.length > 0) {
        data.links = hrefs.join(' | ');
    }
    if (linkTitles.length > 0) {
        data.linkTitles = linkTitles.join(' | ');
    }

    // 9. Input values (for form elements)
    const inputs = element.querySelectorAll('input, select, textarea');
    const inputValues = [];
    inputs.forEach(input => {
        const val = input.value || input.getAttribute('value');
        if (val && val.trim()) {
            inputValues.push(val.replace(/"/g, '""').trim());
        }
    });
    if (inputValues.length > 0) {
        data.inputValues = inputValues.join(' | ');
    }

    // 10. Aria-describedby content (tooltip/description references)
    const describedBy = element.getAttribute('aria-describedby');
    if (describedBy) {
        const descEl = document.getElementById(describedBy);
        if (descEl && descEl.textContent) {
            data.ariaDescription = descEl.textContent.replace(/"/g, '""').replace(/\n/g, ' ').trim();
        }
    }

    return data;
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
    } else if (request.action === "GET_ITEM_DATA") {
        // Data-only mode: extract comprehensive data including hover information
        const list = detectedLists.find(l => l.id === request.listId);
        if (!list || !list.items[request.index]) {
            sendResponse({ success: false, error: "Item not found" });
        } else {
            const item = list.items[request.index];
            const itemData = extractItemData(item);
            sendResponse({ success: true, ...itemData });
        }
    } else if (request.action === "GET_ALL_FIELDS") {
        // Get all unique field names from all items in the list
        const list = detectedLists.find(l => l.id === request.id);
        if (!list) {
            sendResponse({ success: false, error: "List not found" });
        } else {
            const allFields = new Set(['text']); // 'text' is always present
            list.items.forEach(item => {
                const data = extractItemData(item);
                Object.keys(data).forEach(key => allFields.add(key));
            });
            sendResponse({ success: true, fields: Array.from(allFields) });
        }
    } else if (request.action === "GET_LIST_INFO") {
        const list = detectedLists.find(l => l.id === request.id);
        if (list) {
            sendResponse({ success: true, count: list.items.length });
        } else {
            sendResponse({ success: false, error: "List not found" });
        }
    }
});
