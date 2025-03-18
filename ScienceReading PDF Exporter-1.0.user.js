// ==UserScript==
// @name         ScienceReading PDF Exporter
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Export ScienceReading PDF with preserved bookmarks
// @author       TsXor
// @author       xmp4660
// @match        https://book.sciencereading.cn/shop/book/Booksimple/onlineRead.do?*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    async function downloadBlob(blob, fileName) {
        const downloadElement = document.createElement('a');
        const href = window.URL.createObjectURL(blob);
        downloadElement.href = href;
        downloadElement.download = fileName;
        document.body.appendChild(downloadElement);
        downloadElement.click();
        document.body.removeChild(downloadElement);
        window.URL.revokeObjectURL(href);
    }

    function mergeArrayBuffers(arrayBuffers) {
        let totalLength = arrayBuffers.reduce((acc, buffer) => acc + buffer.byteLength, 0);
        const mergedBuffer = new ArrayBuffer(totalLength);
        const uint8Array = new Uint8Array(mergedBuffer);
        let offset = 0;
        for (const buffer of arrayBuffers) {
            uint8Array.set(new Uint8Array(buffer), offset);
            offset += buffer.byteLength;
        }
        return mergedBuffer;
    }

    async function dumpBookmarks(api) {
        async function dump(data) {
            const children = await Promise.all((await api.getBookmarkChildren(data.id)).map(dump));
            return { data, children };
        }
        return Promise.all((await api.getBookmarkChildren()).map(dump));
    }

    async function loadBookmarks(api, tree) {
        async function load(node, parent) {
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
                destId: parent?.data.id,
                relationship: 1 /* LAST_CHILD */,
            });
            await Promise.all(node.children.map(child => load(child, node)));
        }
        await Promise.all(tree.map(node => load(node, null)));
    }

    function createExportButton() {
        const btn = document.createElement('button');
        btn.innerHTML = 'Export PDF with Bookmarks';
        btn.style.position = 'fixed';
        btn.style.bottom = '20px';
        btn.style.right = '20px';
        btn.style.zIndex = 9999;
        btn.style.padding = '10px 20px';
        btn.style.backgroundColor = '#4CAF50';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.borderRadius = '4px';
        btn.style.cursor = 'pointer';

        btn.addEventListener('click', async () => {
            try {
                if (!window.pdfui) {
                    alert('PDF UI API not available!');
                    return;
                }

                btn.disabled = true;
                btn.innerHTML = 'Exporting...';

                const bookmarkApi = await pdfui.getBookmarkDataService();
                const doc = await pdfui.getCurrentPDFDoc();
                const fileName = doc.getFileName();
                const count = doc.getPageCount();
                const pages = mergeArrayBuffers(await doc.extractPages([[0, count - 1]]));
                const bookmarks = await dumpBookmarks(bookmarkApi);

                const newDoc = await pdfui.createNewDoc(fileName);
                await newDoc.insertPages({
                    file: pages,
                    startIndex: 0,
                    endIndex: count - 1,
                });

                if (newDoc.getPageCount() > count) {
                    await newDoc.removePage(newDoc.getPageCount() - 1);
                }

                await loadBookmarks(bookmarkApi, bookmarks);
                const file = await newDoc.getFile();
                downloadBlob(file, fileName);
            } catch (error) {
                alert('Export failed: ' + error.message);
                console.error(error);
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Export PDF with Bookmarks';
            }
        });

        document.body.appendChild(btn);
    }

    // 初始化按钮
    window.addEventListener('load', () => {
        if (document.querySelector('#tm-pdf-exporter')) return;
        createExportButton();
    });
})();