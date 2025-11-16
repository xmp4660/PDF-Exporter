// ==UserScript==
// @name         ScienceReading PDF Exporter
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Export ScienceReading PDF with preserved bookmarks (DRM-free)
// @author       TsXor, xmp4660
// @match        https://book.sciencereading.cn/shop/book/Booksimple/onlineRead.do?*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // --- Constants ---
    const BUTTON_ID = 'science-reading-export-btn';
    const DEFAULT_FILE_NAME = 'ScienceReading_Book';
    const FILE_EXTENSION = '.pdf';

    // --- Utility Functions ---

    /**
     * Downloads a Blob as a file.
     * @param {Blob} blob - The file content.
     * @param {string} fileName - Desired file name.
     */
    function downloadBlob(blob, fileName) {
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * Merges an array of ArrayBuffers into a single ArrayBuffer.
     * @param {ArrayBuffer[]} buffers - Array of ArrayBuffers.
     * @returns {ArrayBuffer} Merged buffer.
     */
    function mergeArrayBuffers(buffers) {
        const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const buffer of buffers) {
            merged.set(new Uint8Array(buffer), offset);
            offset += buffer.byteLength;
        }
        return merged.buffer;
    }

    /**
     * Sanitizes a filename by removing illegal characters.
     * @param {string} name - Raw filename.
     * @returns {string} Safe filename.
     */
    function sanitizeFilename(name) {
        if (typeof name !== 'string') return 'exported_book';
        return (
            name
                .replace(/[/\\:*?"<>|]/g, '')
                .substring(0, 100)
                .trim() || 'exported_book'
        );
    }

    // --- Bookmark Handling ---

    /**
     * Recursively dumps the bookmark tree.
     * @param {Object} api - Bookmark data service API.
     * @returns {Promise<Array>} Bookmark tree structure.
     */
    async function dumpBookmarks(api) {
        async function traverse(node) {
            const children = await Promise.all(
                (await api.getBookmarkChildren(node.id)).map(traverse)
            );
            return { data: node, children };
        }
        const roots = await api.getBookmarkChildren();
        return Promise.all(roots.map(traverse));
    }

    /**
     * Restores bookmarks into a new document.
     * @param {Object} api - Target document's bookmark API.
     * @param {Array} tree - Bookmark tree from dumpBookmarks.
     */
    async function restoreBookmarks(api, tree) {
        async function insert(node, parent) {
            const destId = parent ? parent.data.id : undefined;
            node.data.id = await api.addBookmark({
                color: node.data.color,
                destination: {
                    pageIndex: node.data.page,
                    left: node.data.left,
                    top: node.data.top,
                    zoomFactor: node.data.zoomFactor,
                    zoomMode: node.data.zoomMode,
                },
                style: {
                    bold: node.data.isBold,
                    italic: node.data.isItalic,
                },
                title: node.data.title,
                destId,
                relationship: 1, // LAST_CHILD
            });
            await Promise.all(node.children.map(child => insert(child, node)));
        }
        await Promise.all(tree.map(root => insert(root, null)));
    }

    // --- Main Export Logic ---

    /**
     * Safely retrieves the original PDF filename.
     * @param {Object} doc - PDF document instance.
     * @returns {string} Cleaned filename or default.
     */
    function getOriginalFileName(doc) {
        try {
            const rawName = typeof doc.getFileName === 'function' ? doc.getFileName() : '';
            if (typeof rawName === 'string' && rawName.trim()) {
                return rawName.replace(/\.pdf$/i, '').trim();
            }
        } catch (err) {
            console.warn('[Exporter] Failed to get filename:', err);
        }
        return DEFAULT_FILE_NAME;
    }

    /**
     * Creates and appends the export button to the page.
     */
    function createExportButton() {
        if (document.getElementById(BUTTON_ID)) return;

        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.textContent = 'Export PDF with Bookmarks';
        Object.assign(button.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: '9999',
            padding: '10px 20px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        });

        button.addEventListener('click', async () => {
            try {
                if (!window.pdfui) {
                    alert('PDF UI API not available! Please wait for the PDF to fully load.');
                    return;
                }

                button.disabled = true;
                button.textContent = 'Preparing...';

                const doc = await window.pdfui.getCurrentPDFDoc();
                const baseName = getOriginalFileName(doc);
                const defaultName = `${baseName}_with_bookmarks`;

                const userInput = prompt('请输入文件名（无需输入 .pdf 后缀）:', defaultName);
                if (userInput === null) return; // User canceled

                let fileName = sanitizeFilename(userInput);
                if (!fileName.toLowerCase().endsWith(FILE_EXTENSION)) {
                    fileName += FILE_EXTENSION;
                }

                button.textContent = 'Extracting pages...';
                const bookmarkApi = await window.pdfui.getBookmarkDataService();
                const pageCount = doc.getPageCount();

                const pageBuffers = await doc.extractPages([[0, pageCount - 1]]);
                const mergedPages = mergeArrayBuffers(pageBuffers);
                const bookmarks = await dumpBookmarks(bookmarkApi);

                button.textContent = 'Creating new document...';
                const newDoc = await window.pdfui.createNewDoc(fileName);
                await newDoc.insertPages({
                    file: mergedPages,
                    startIndex: 0,
                    endIndex: pageCount - 1,
                });

                // Remove extra blank page if present
                if (newDoc.getPageCount() > pageCount) {
                    await newDoc.removePage(newDoc.getPageCount() - 1);
                }

                // Get bookmark API for the NEW document
                let newBookmarkApi;
                if (typeof newDoc.getBookmarkDataService === 'function') {
                    newBookmarkApi = await newDoc.getBookmarkDataService();
                } else if (typeof window.pdfui.getBookmarkDataService === 'function') {
                    newBookmarkApi = await window.pdfui.getBookmarkDataService(newDoc);
                } else {
                    throw new Error('Failed to obtain bookmark API for new document');
                }

                button.textContent = 'Restoring bookmarks...';
                await restoreBookmarks(newBookmarkApi, bookmarks);

                button.textContent = 'Generating file...';
                const fileBlob = await newDoc.getFile();
                downloadBlob(fileBlob, fileName);

                button.textContent = '✅ Done!';
                setTimeout(() => {
                    button.textContent = 'Export PDF with Bookmarks';
                    button.disabled = false;
                }, 2000);
            } catch (error) {
                console.error('[ScienceReading Exporter] Error:', error);
                alert(`导出失败：\n${error.message || String(error)}`);
                button.textContent = '❌ Export Failed';
                setTimeout(() => {
                    button.textContent = 'Export PDF with Bookmarks';
                    button.disabled = false;
                }, 2000);
            }
        });

        document.body.appendChild(button);
    }

    // --- Initialization ---

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createExportButton);
    } else {
        createExportButton();
    }
})();
