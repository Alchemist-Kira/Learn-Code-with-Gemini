// Configuration
const CONFIG = {
    // API Configuration
    API: {
        key: '', // Empty by default, user must provide their own key
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
    },
    // Judge0 API Configuration
    JUDGE0: {
        key: '', // Empty by default, user must provide their own key
        host: 'judge0-ce.p.rapidapi.com',
        languages: {
            'python': 71,    // Python 3.9.4
            'java': 62,      // Java 13.0.1
            'cpp': 54,       // C++ (GCC 9.2.0)
            'javascript': 63 // JavaScript (Node.js 12.14.0)
        }
    }
};

// DOM Elements
const codeEditor = document.getElementById('code-editor');
const previewFrame = document.getElementById('preview-frame');
const previewContainer = document.getElementById('right-panel');
const aiPrompt = document.getElementById('ai-prompt');
const aiResponse = document.getElementById('ai-response');
const previewOverlay = document.getElementById('preview-overlay');
const lineNumbers = document.getElementById('line-numbers');
const editorTabsContainer = document.getElementById('editor-tabs-container');
const sidebar = document.getElementById('sidebar');
const editorContainer = document.querySelector('.editor-container');
const editorAndRightPanelContainer = document.querySelector('.editor-and-right-panel-container');
const outputConsole = document.getElementById('output-console'); // For run output
const openedFolderName = document.getElementById('opened-folder-name');
const directoryFilesList = document.getElementById('directory-files-list');
const openFilesList = document.getElementById('open-files-list');
const resizer = document.getElementById('resizer');

// File System Access API related variables
let fileHandlesMap = {}; 
let openedDirectoryHandle = null; 
let currentFile = null; 
let currentLanguage = 'html';

let files = {}; 

const defaultNewFileContent = {
    'html': `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>New HTML File</title>
</head>
<body>
    <h1>Hello from a new HTML file!</h1>
</body>
</html>`,
    'css': `/* Add your new CSS styles here */
body {
    font-family: sans-serif;
    background-color: #f0f0f0;
}`,
    'javascript': `// Add your new JavaScript code here
console.log("Hello from a new JS file!");`,
    'python': `# Add your new Python code here
print("Hello from a new Python file!")`,
    'java': `// Add your new Java code here
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from a new Java file!");
    }
}`,
    'cpp': `// Add your new C++ code here
#include <iostream>

int main() {
    std::cout << "Hello from a new C++ file!" << std::endl;
    return 0;
}`
};

const extensionToLanguage = {
    'html': 'html', 'css': 'css', 'js': 'javascript',
    'py': 'python', 'java': 'java', 'cpp': 'cpp',
    'rs': 'rust', 'txt': 'text', // Added Rust
};

function getLanguageFromFileName(fileName) {
    const parts = fileName.split('.');
    if (parts.length > 1) {
        const extension = parts[parts.length - 1];
        return extensionToLanguage[extension.toLowerCase()] || 'text';
    }
    return 'text';
}

// --- Sidebar Toggling ---
function toggleSidebar() {
    sidebar.classList.toggle('collapsed');
}

// --- Right Panel (Preview) Toggling ---
function toggleRightPanel(forceState = null) {
    const previewContainer = document.getElementById('right-panel');
    const editorContainer = document.querySelector('.editor-container');
    const toggleButton = document.querySelector('button[onclick="toggleRightPanel()"]');
    const toggleIcon = toggleButton.querySelector('i');
    const resizer = document.getElementById('resizer');
    
    let shouldBeCollapsed;
    if (forceState !== null) { // If state is forced (true for expand, false for collapse)
        shouldBeCollapsed = !forceState;
    } else { // Toggle
        shouldBeCollapsed = !previewContainer.classList.contains('collapsed');
    }

    if (shouldBeCollapsed) {
        // Store current widths before collapsing
        lastEditorWidth = editorContainer.style.width;
        lastPreviewWidth = previewContainer.style.width;
        
        // Collapse the panel
        previewContainer.classList.add('collapsed');
        editorContainer.style.width = '100%';
        resizer.style.display = 'none';
        toggleIcon.classList.remove('fa-eye');
        toggleIcon.classList.add('fa-eye-slash'); // Icon for 'show'
        toggleButton.title = 'Show Preview Panel';
    } else {
        // Expand the panel
        previewContainer.classList.remove('collapsed');
        resizer.style.display = 'block';

        // Ensure widths are not '0px' if the panel was collapsed and never resized, or if window resized
        let editorW = lastEditorWidth;
        let previewW = lastPreviewWidth;
        if (editorW === '0px' || previewW === '0px' || !editorW || !previewW) {
            editorW = '50%';
            previewW = '50%';
        }
        editorContainer.style.width = editorW;
        previewContainer.style.width = previewW;
        
        toggleIcon.classList.remove('fa-eye-slash'); // Icon for 'hide'
        toggleIcon.classList.add('fa-eye');
        toggleButton.title = 'Hide Preview Panel';
        
        // Ensure the correct tab is active when showing the panel
        const activeTab = document.querySelector('.preview-tab.active');
        if (activeTab) {
            const sectionId = activeTab.getAttribute('onclick').match(/'([^']+)'/)[1];
            switchPreviewPaneTab(sectionId, activeTab);
        } else {
            const currentFileLang = currentFile ? getLanguageFromFileName(currentFile) : '';
            if (['html', 'css', 'js'].includes(currentFileLang)) {
                switchPreviewPaneTab('preview-section', document.querySelector('.preview-tab[onclick*="preview-section"]'));
            } else if (document.getElementById('output-console').textContent.trim() !== '') {
                switchPreviewPaneTab('output-section', document.querySelector('.preview-tab[onclick*="output-section"]'));
            } else {
                switchPreviewPaneTab('ai-section', document.querySelector('.preview-tab[onclick*="ai-section"]'));
            }
        }
    }
}

// --- File System Access API Integration ---

async function openFilePicker() {
    try {
        const options = {
            types: [
                {
                    description: 'All Files',
                    accept: {
                        'text/*': ['.txt', '.html', '.css', '.js', '.py', '.java', '.cpp'],
                        'application/json': ['.json']
                    }
                }
            ],
            excludeAcceptAllOption: false,
            multiple: false
        };
        
        const [fileHandle] = await window.showOpenFilePicker(options);
        await readFile(fileHandle);
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Error opening file:', err);
        }
    }
}

async function readFile(fileHandle, relativePath = null) {
    const file = await fileHandle.getFile();
    const content = await file.text();
    const fileName = relativePath || file.name;

    // Store the file handle with its full path
    fileHandlesMap[fileName] = fileHandle;

    // Determine language from extension
    const language = getLanguageFromFileName(fileName);

    // Add/update file in our internal `files` object
    files[fileName] = { 
        content: content, 
        language: language, 
        isNew: false,
        path: fileName // Store the full path
    };

    // Create a tab and switch to it
    if (!document.querySelector(`.editor-tabs .tab[data-file="${fileName}"]`)) {
        const tab = createTabElement(fileName);
        editorTabsContainer.insertBefore(tab, document.querySelector('.new-tab-btn'));
    }
    
    // Add to "Open Files" in sidebar
    addFileToExplorer(fileName, 'open-files-list', fileHandle);

    switchFile(fileName);
}

// --- Folder Collapse/Expand (Dynamic) ---
async function listDirectoryContents(dirHandle, parentElement, currentPath) {
    parentElement.innerHTML = '';
    const folders = [];
    const filesInDir = [];

    // Get all entries in the current directory
    for await (const entry of dirHandle.values()) {
        const entryPath = `${currentPath}/${entry.name}`;
        if (entry.kind === 'directory') {
            folders.push({ name: entry.name, path: entryPath, handle: entry });
        } else {
            filesInDir.push({ name: entry.name, path: entryPath, handle: entry });
        }
    }

    // Sort folders and files alphabetically
    folders.sort((a, b) => a.name.localeCompare(b.name));
    filesInDir.sort((a, b) => a.name.localeCompare(b.name));

    // Create folder elements
    for (const folder of folders) {
        const folderElement = document.createElement('div');
        folderElement.className = 'file-tree-item folder-root';
        folderElement.setAttribute('data-path', folder.path);
        folderElement.innerHTML = `
            <i class="fas fa-chevron-right folder-toggle"></i>
            <i class="fas fa-folder"></i> 
            <span class="folder-name">${folder.name}</span>
            <div class="file-list"></div>
        `;
        parentElement.appendChild(folderElement);

        const folderToggleIcon = folderElement.querySelector('.folder-toggle');
        const fileListContainer = folderElement.querySelector('.file-list');
        
        folderToggleIcon.addEventListener('click', async (e) => {
            e.stopPropagation();
            const parentFolderRoot = e.target.closest('.folder-root');
            if (parentFolderRoot) {
                parentFolderRoot.classList.toggle('expanded');
                if (parentFolderRoot.classList.contains('expanded') && fileListContainer.children.length === 0) {
                    await listDirectoryContents(folder.handle, fileListContainer, folder.path);
                }
            }
        });
    }

    // Create file elements
    for (const file of filesInDir) {
        addFileToExplorer(file.name, parentElement, file.handle, file.path);
    }
}

function addFileToExplorer(fileName, parentElementId, fileHandle, filePath = fileName) {
    let parentElement;
    if (typeof parentElementId === 'string') {
        parentElement = document.getElementById(parentElementId);
    } else {
        parentElement = parentElementId;
    }
    
    // Check if the file already exists in the explorer list
    if (parentElement.querySelector(`.file-tree-item[data-file="${filePath}"]`)) {
        return;
    }

    const fileItem = document.createElement('div');
    fileItem.className = 'file-tree-item file';
    fileItem.setAttribute('data-file', filePath);
    
    // Show the full path in the explorer
    const displayName = filePath.split('/').pop();
    fileItem.innerHTML = `<i class="${getFileIcon(fileName)}"></i> ${displayName}`;
    
    fileItem.addEventListener('click', async () => {
        if (files[filePath]) {
            switchFile(filePath);
        } else if (fileHandle) {
            await readFile(fileHandle, filePath);
        }
    });
    
    parentElement.appendChild(fileItem);
}

function getFileIcon(fileName) {
    const extension = fileName.split('.').pop().toLowerCase();
    switch (extension) {
        case 'html': return 'fab fa-html5';
        case 'css': return 'fab fa-css3-alt';
        case 'js': return 'fab fa-js';
        case 'py': return 'fab fa-python';
        case 'java': return 'fab fa-java';
        case 'cpp': return 'fas fa-file-code';
        case 'json': return 'fas fa-file-code';
        case 'md': return 'fab fa-markdown';
        case 'txt': return 'fas fa-file-alt';
        case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': return 'fas fa-image';
        default: return 'fas fa-file';
    }
}

async function saveCode() {
    if (!currentFile) {
        alert('No file is open to save.');
        return;
    }

    const fileContent = codeEditor.value;
    files[currentFile].content = fileContent; // Update internal content

    // If it's a file opened via FSA API or previously saved
    if (fileHandlesMap[currentFile]) {
        try {
            const writable = await fileHandlesMap[currentFile].createWritable();
            await writable.write(fileContent);
            await writable.close();
            files[currentFile].isNew = false; // Mark as not new once saved
            alert(`File "${currentFile}" saved successfully!`);
        } catch (err) {
            console.error('Error saving file:', err);
            alert('Failed to save file: ' + err.message);
        }
    } else {
        // If it's a newly created tab not yet saved to disk
        await saveFileAs();
    }
    saveAppStateToLocalStorage(); // Always save app state after a save operation
}

async function saveFileAs() {
    if (!currentFile) {
        alert('Please open or create a file first');
        return;
    }

    try {
        const options = {
            types: [{
                description: 'Text Files',
                accept: {
                    'text/*': [`.${languageToExtension(currentLanguage)}`]
                }
            }],
            suggestedName: currentFile
        };

        const fileHandle = await window.showSaveFilePicker(options);
        const writable = await fileHandle.createWritable();
        await writable.write(codeEditor.value);
        await writable.close();

        // Update the file handle map
        fileHandlesMap[currentFile] = fileHandle;
        
        // Update the file tree if needed
        const fileName = currentFile.split('/').pop();
        const fileElement = document.querySelector(`[data-file-path="${currentFile}"]`);
        if (fileElement) {
            fileElement.querySelector('.file-name').textContent = fileName;
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Error saving file:', err);
            alert('Error saving file. Please try again.');
        }
    }
}


// --- Tab Management ---
async function addNewTab() {
    try {
        // First, ask user where to save the file
        const options = {
            types: [{
                description: 'Text Files',
                accept: {
                    'text/*': ['.txt', '.html', '.css', '.js', '.py', '.java', '.cpp']
                }
            }],
            suggestedName: 'new_file.txt'
        };

        const fileHandle = await window.showSaveFilePicker(options);
        const fileName = fileHandle.name;

        // Check if file already exists in our editor
        if (files[fileName]) {
            // File already exists, just switch to it
            switchFile(fileName);
            return;
        }

        // Check if file exists on disk
        try {
            const file = await fileHandle.getFile();
            const content = await file.text();
            const language = getLanguageFromFileName(fileName);
            
            // Store the file handle and content
            fileHandlesMap[fileName] = fileHandle;
            files[fileName] = { 
                content: content, 
                language: language, 
                isNew: false 
            };

            // Create tab and switch to it
            const tab = createTabElement(fileName);
            editorTabsContainer.insertBefore(tab, document.querySelector('.new-tab-btn'));
            addFileToExplorer(fileName, 'open-files-list', fileHandle);
            switchFile(fileName);
            saveAppStateToLocalStorage();
        } catch (err) {
            // If file doesn't exist, create it with default content
            const language = getLanguageFromFileName(fileName);
            const defaultContent = defaultNewFileContent[language] || '';
            
            const writable = await fileHandle.createWritable();
            await writable.write(defaultContent);
            await writable.close();

            // Store the file handle and content
            fileHandlesMap[fileName] = fileHandle;
            files[fileName] = { 
                content: defaultContent, 
                language: language, 
                isNew: false 
            };

            // Create tab and switch to it
            const tab = createTabElement(fileName);
            editorTabsContainer.insertBefore(tab, document.querySelector('.new-tab-btn'));
            addFileToExplorer(fileName, 'open-files-list', fileHandle);
            switchFile(fileName);
            saveAppStateToLocalStorage();
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Error creating/opening file:', err);
            alert('Error creating/opening file. Please try again.');
        }
    }
}

function closeTab(fileName) {
    if (!files[fileName]) return; // File not found

    // Check if the file is new and has unsaved content
    if (files[fileName].isNew && files[fileName].content.trim() !== defaultNewFileContent[files[fileName].language].trim() && !confirm(`File "${fileName}" has unsaved changes. Close anyway?`)) {
        return;
    }

    // Remove tab element
    const tabElement = document.querySelector(`.editor-tabs .tab[data-file="${fileName}"]`);
    if (tabElement) {
        tabElement.remove();
    }
    
    // Remove from explorer's "Open Files" list
    const explorerFileItem = document.querySelector(`#open-files-list .file-tree-item[data-file="${fileName}"]`);
    if (explorerFileItem) {
        explorerFileItem.remove();
    }

    delete files[fileName];
    delete fileHandlesMap[fileName]; // Also remove handle reference

    if (currentFile === fileName) {
        // Find the next tab to switch to
        const remainingFiles = Object.keys(files);
        if (remainingFiles.length > 0) {
            switchFile(remainingFiles[0]); // Switch to the first available file
        } else {
            // No files left, clear editor and state
            codeEditor.value = '';
            currentFile = null;
            updateLineNumbers();
            updatePreview(); // Clear preview content
            aiResponse.innerHTML = ''; // Clear AI chat
            outputConsole.textContent = ''; // Clear output console
            
            // Show AI chat in the right panel
            const aiButton = document.querySelector('.preview-tab[onclick*="ai-section"]');
            if (aiButton) switchPreviewPaneTab('ai-section', aiButton);
            toggleRightPanel(true); // Ensure right panel is visible
        }
    }
    saveAppStateToLocalStorage();
}

function switchFile(fileName) {
    if (!fileName || !files[fileName]) {
        return;
    }

    // Remove active class from all tabs
    document.querySelectorAll('.editor-tabs .tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Find and activate the target tab
    const targetTabElement = document.querySelector(`.editor-tabs .tab[data-file="${fileName}"]`);
    if (targetTabElement) {
        targetTabElement.classList.add('active');
    }

    // Set active class on explorer item
    document.querySelectorAll('.file-tree-item.file').forEach(item => {
        item.classList.remove('active');
    });
    const targetExplorerItem = document.querySelector(`.file-tree-item.file[data-file="${fileName}"]`);
    if (targetExplorerItem) {
        targetExplorerItem.classList.add('active');
    }

    // Update current file and editor content
    currentFile = fileName;
    codeEditor.value = files[fileName].content || '';
    
    // Set language based on file extension
    currentLanguage = getLanguageFromFileName(fileName);
    
    // Set run button state
    const runButton = document.getElementById('runButton');
    runButton.disabled = !(Object.values(extensionToLanguage).includes(currentLanguage));

    // Handle preview panel visibility based on file type
    const previewContainer = document.getElementById('right-panel');
    const editorContainer = document.querySelector('.editor-container');
    const fileExtension = getLanguageFromFileName(fileName);

    if (['html', 'css', 'js'].includes(fileExtension)) {
        // Show preview for web files
        previewContainer.classList.remove('collapsed');
        editorContainer.style.width = lastEditorWidth;
        previewContainer.style.width = lastPreviewWidth;
        switchPreviewPaneTab('preview-section', document.querySelector('.preview-tab[onclick*="preview-section"]'));
    } else {
        // Hide preview for non-web files
        previewContainer.classList.add('collapsed');
        editorContainer.style.width = '100%';
    }

    updateLineNumbers();
    saveAppStateToLocalStorage();
}

function createTabElement(fileName) {
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.setAttribute('data-file', fileName); // Use full path for data-file
    
    const fileNameSpan = document.createElement('span');
    fileNameSpan.className = 'tab-name';
    fileNameSpan.textContent = fileName.split('/').pop(); // Display only the file name
    fileNameSpan.addEventListener('dblclick', () => renameTab(fileName));
    
    const closeButton = document.createElement('span');
    closeButton.className = 'tab-close';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent tab switch when closing
        closeTab(fileName);
    });
    
    tab.appendChild(fileNameSpan);
    tab.appendChild(closeButton);
    
    tab.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        switchFile(fileName);
    });
    
    return tab;
}

function renameTab(oldFileName) {
    const tabElement = document.querySelector(`.tab[data-file="${oldFileName}"]`);
    if (!tabElement) return;
    
    const fileNameSpan = tabElement.querySelector('.tab-name');
    if (!fileNameSpan) return;
    
    const currentDisplayName = fileNameSpan.textContent;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentDisplayName;
    input.className = 'tab-rename-input';
    
    fileNameSpan.replaceWith(input);
    input.focus();
    input.select();
    
    const finishRenaming = async () => {
        const newDisplayName = input.value.trim();
        if (!newDisplayName || newDisplayName === currentDisplayName) {
            // Revert if empty or same name
            input.replaceWith(fileNameSpan);
            fileNameSpan.textContent = currentDisplayName;
            fileNameSpan.addEventListener('dblclick', () => renameTab(oldFileName));
            return;
        }

        const oldExtension = oldFileName.split('.').pop();
        const newExtension = newDisplayName.split('.').pop();
        if (newExtension !== oldExtension) {
            alert(`Changing file extension is not allowed during rename. Old: ".${oldExtension}", New: ".${newExtension}"`);
            input.replaceWith(fileNameSpan);
            fileNameSpan.textContent = currentDisplayName;
            fileNameSpan.addEventListener('dblclick', () => renameTab(oldFileName));
            return;
        }

        // Determine new full path if it was in a directory (important for files from opened folder)
        let newFileName;
        const oldPathParts = oldFileName.split('/');
        if (oldPathParts.length > 1) {
            oldPathParts[oldPathParts.length - 1] = newDisplayName;
            newFileName = oldPathParts.join('/');
        } else {
            newFileName = newDisplayName; // It's a root-level file name
        }
        
        // Check if the new name (full path) already exists in our `files` object
        if (files[newFileName] && newFileName !== oldFileName) {
            alert(`File with name "${newFileName}" already exists. Please choose a different name.`);
            input.replaceWith(fileNameSpan);
            fileNameSpan.textContent = currentDisplayName;
            fileNameSpan.addEventListener('dblclick', () => renameTab(oldFileName));
            return;
        }

        try {
            // IMPORTANT: File System Access API does NOT directly support renaming files on disk (FileSystemFileHandle.rename is not standard)
            // This rename is ONLY for the in-memory representation and UI.
            // User must use "Save As" to rename on disk.
            if (fileHandlesMap[oldFileName]) {
                 console.warn("File System Access API does not directly support renaming files on disk. This rename is for UI only.");
                 // You could implement a 'Save As' here and then delete the old in-memory file.
            }
            
            // Update internal files object
            files[newFileName] = files[oldFileName];
            delete files[oldFileName];
            
            // Update file handles map
            if (fileHandlesMap[oldFileName]) {
                fileHandlesMap[newFileName] = fileHandlesMap[oldFileName];
                delete fileHandlesMap[oldFileName];
            }

            // Update current file if it was the renamed one
            if (currentFile === oldFileName) {
                currentFile = newFileName;
            }
            
            // Update the DOM element's attributes and text content
            tabElement.setAttribute('data-file', newFileName);
            fileNameSpan.textContent = newDisplayName;
            input.replaceWith(fileNameSpan); // Replace input with original span
            fileNameSpan.addEventListener('dblclick', () => renameTab(newFileName)); // Re-attach listener

            // Update explorer entry (if it exists)
            const explorerItem = document.querySelector(`.file-tree-item[data-file="${oldFileName}"]`);
            if (explorerItem) {
                explorerItem.setAttribute('data-file', newFileName);
                explorerItem.innerHTML = `<i class="${getFileIcon(newFileName)}"></i> ${newDisplayName}`;
                // Re-attach click listener for explorer item
                explorerItem.onclick = async () => {
                    if (files[newFileName]) {
                        switchFile(newFileName);
                    } else if (fileHandlesMap[newFileName]) {
                        await readFile(fileHandlesMap[newFileName], newFileName);
                    }
                };
            }

            updatePreview();
            saveAppStateToLocalStorage(); // Save state after rename
            
        } catch (error) {
            console.error('Error during tab rename:', error);
            alert('Failed to rename tab: ' + error.message);
            // Revert UI on error
            input.replaceWith(fileNameSpan);
            fileNameSpan.textContent = currentDisplayName;
            fileNameSpan.addEventListener('dblclick', () => renameTab(oldFileName));
        }
    };
    
    input.addEventListener('blur', finishRenaming);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            finishRenaming();
        }
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            input.replaceWith(fileNameSpan);
            fileNameSpan.textContent = currentDisplayName;
            fileNameSpan.addEventListener('dblclick', () => renameTab(oldFileName));
        }
    });
}

function languageToExtension(lang) {
    for (const ext in extensionToLanguage) {
        if (extensionToLanguage[ext] === lang) {
            return ext;
        }
    }
    return 'txt'; // Default if no matching extension
}

let pyodide = null;

async function loadPyodide() {
    if (!pyodide) {
        // Load Pyodide
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js';
        document.head.appendChild(script);

        await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = reject;
        });

        // Initialize Pyodide
        pyodide = await window.loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.24.1/full/"
        });
    }
    return pyodide;
}

async function runCode() {
    const code = codeEditor.value;
    if (currentFile) {
        files[currentFile].content = code;
    }
    const language = currentLanguage;

    // Show output section
    const previewContainer = document.getElementById('right-panel');
    const editorContainer = document.querySelector('.editor-container');
    
    // Ensure right panel is visible
    previewContainer.classList.remove('collapsed');
    editorContainer.style.width = '50%';
    previewContainer.style.width = '50%';
    
    switchPreviewPaneTab('output-section', document.querySelector('.preview-tab[onclick*="output-section"]'));
    
    // Clear previous output
    outputConsole.innerHTML = '';

    if (language === 'html' || language === 'css') {
        updatePreview();
        appendTerminalOutput(`Preview updated for ${language} file.`);
        return;
    }

    if (language === 'javascript') {
        const iframeWindow = previewFrame.contentWindow;

        // Clear iframe content to prevent lingering scripts if running JS not linked in HTML
        previewFrame.srcdoc = '<!DOCTYPE html><html><head><title>JS Runner</title></head><body></body></html>';
        await new Promise(resolve => previewFrame.onload = resolve); // Wait for iframe to load

        const originalConsoleLog = iframeWindow.console.log;
        const originalConsoleError = iframeWindow.console.error;
        const originalConsoleWarn = iframeWindow.console.warn;
        const originalPrompt = iframeWindow.prompt;

        // Capture output directly to `outputConsole`
        iframeWindow.console.log = (...args) => {
            const message = args.map(arg => String(arg)).join(' ');
            appendTerminalOutput(message);
            originalConsoleLog.apply(iframeWindow.console, args);
        };
        iframeWindow.console.error = (...args) => {
            const message = 'ERROR: ' + args.map(arg => String(arg)).join(' ');
            appendTerminalError(message);
            originalConsoleError.apply(iframeWindow.console, args);
        };
        iframeWindow.console.warn = (...args) => {
            const message = 'WARNING: ' + args.map(arg => String(arg)).join(' ');
            appendTerminalOutput(message);
            originalConsoleWarn.apply(iframeWindow.console, args);
        };

        // Override prompt to use our custom input
        iframeWindow.prompt = async (message) => {
            return new Promise((resolve) => {
                const inputContainer = document.createElement('div');
                inputContainer.className = 'code-input-container';
                
                const label = document.createElement('label');
                label.textContent = message || 'Enter input:';
                
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'code-input';
                
                const button = document.createElement('button');
                button.textContent = 'Submit';
                button.className = 'code-input-submit';
                
                inputContainer.appendChild(label);
                inputContainer.appendChild(input);
                inputContainer.appendChild(button);
                
                outputConsole.parentNode.insertBefore(inputContainer, outputConsole.nextSibling);
                
                const handleSubmit = () => {
                    const value = input.value;
                    inputContainer.remove();
                    resolve(value);
                };
                
                button.onclick = handleSubmit;
                input.onkeypress = (e) => {
                    if (e.key === 'Enter') {
                        handleSubmit();
                    }
                };
                
                input.focus();
            });
        };

        try {
            iframeWindow.eval(code);
            if (outputConsole.textContent === 'Running code...') {
                appendTerminalOutput('JavaScript code executed. No console output.');
            }
        } catch (error) {
            appendTerminalError(`\nJavaScript Execution Error:\n${error.message}`);
        } finally {
            // Restore original console functions
            iframeWindow.console.log = originalConsoleLog;
            iframeWindow.console.error = originalConsoleError;
            iframeWindow.console.warn = originalConsoleWarn;
            iframeWindow.prompt = originalPrompt;
        }
    } else if (language === 'python') {
        try {
            // Load Pyodide if not already loaded
            if (!pyodide) {
                appendTerminalOutput('Loading Python environment...');
                pyodide = await loadPyodide();
            }

            // Override Python's built-in input function
            pyodide.globals.set('input', (prompt) => {
                return new Promise((resolve) => {
                    // Create input container
                    const inputContainer = document.createElement('div');
                    inputContainer.className = 'terminal-line';
                    
                    // Add prompt
                    const promptSpan = document.createElement('span');
                    promptSpan.className = 'terminal-prompt';
                    promptSpan.textContent = prompt || '> ';
                    inputContainer.appendChild(promptSpan);

                    // Add input field
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'terminal-input';
                    inputContainer.appendChild(input);
                    
                    // Add to console
                    outputConsole.appendChild(inputContainer);
                    input.focus();

                    // Handle input
                    input.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            const value = input.value;
                            inputContainer.remove();
                            resolve(value);
                        }
                    });
                });
            });

            // Override Python's built-in print function
            pyodide.globals.set('print', (...args) => {
                const text = args.join(' ');
                appendTerminalOutput(text);
            });

            // Run the code
            await pyodide.runPythonAsync(code);

        } catch (error) {
            appendTerminalError(`Python Error: ${error.message}`);
        }
    } else {
        appendTerminalError(`Running ${language} code is not directly supported in the browser.`);
    }
}

// Function to append terminal output
function appendTerminalOutput(text) {
    const lineDiv = document.createElement('div');
    lineDiv.className = 'terminal-line';
    lineDiv.innerHTML = `<span class="terminal-text">${text}</span>`;
    outputConsole.appendChild(lineDiv);
    outputConsole.scrollTop = outputConsole.scrollHeight;
}

// Function to append terminal error
function appendTerminalError(text) {
    const lineDiv = document.createElement('div');
    lineDiv.className = 'terminal-line';
    lineDiv.innerHTML = `<span class="terminal-error">${text}</span>`;
    outputConsole.appendChild(lineDiv);
    outputConsole.scrollTop = outputConsole.scrollHeight;
}

// --- Save/Load App State to LocalStorage (for in-memory files and active tab) ---
function saveAppStateToLocalStorage() {
    const savedFiles = {};
    for (const fileName in files) {
        savedFiles[fileName] = { 
            content: files[fileName].content, 
            language: files[fileName].language,
            isNew: files[fileName].isNew 
        };
    }
    localStorage.setItem('editorFiles', JSON.stringify(savedFiles));
    localStorage.setItem('activeFile', currentFile);
}

function loadInitialFilesAndState() {
    // Load API keys from localStorage if they exist
    const geminiApiKey = localStorage.getItem('geminiApiKey');
    const judge0ApiKey = localStorage.getItem('judge0ApiKey');
    
    if (geminiApiKey) {
        CONFIG.API.key = geminiApiKey;
    }
    
    if (judge0ApiKey) {
        CONFIG.JUDGE0.key = judge0ApiKey;
    }
    
    // Load editor state
    const savedFiles = localStorage.getItem('editorFiles');
    const lastActiveFile = localStorage.getItem('activeFile');

    Array.from(editorTabsContainer.querySelectorAll('.tab')).forEach(t => t.remove());
    openFilesList.innerHTML = ''; 
    directoryFilesList.innerHTML = '';

    if (savedFiles) {
        try {
            const parsedFiles = JSON.parse(savedFiles);
            files = {}; 
            for (const fileName in parsedFiles) {
                files[fileName] = { 
                    content: parsedFiles[fileName].content, 
                    language: parsedFiles[fileName].language || getLanguageFromFileName(fileName),
                    isNew: parsedFiles[fileName].isNew || false
                };
                const tab = createTabElement(fileName);
                editorTabsContainer.insertBefore(tab, document.querySelector('.new-tab-btn'));
                addFileToExplorer(fileName, 'open-files-list', null, fileName); 
            }
        } catch (e) {
            console.error("Error parsing saved files from localStorage", e);
            files = {};
        }
    }

    if (lastActiveFile && files[lastActiveFile]) {
        currentFile = lastActiveFile;
    } else {
        currentFile = Object.keys(files)[0] || null;
    }

    if (currentFile) {
        switchFile(currentFile); // This will also handle initial preview/AI tab state
    } else {
        codeEditor.value = '';
        updateLineNumbers();
        currentFile = null; // Ensure currentFile is null if no files are open
        // If no file, default to showing AI chat in the right panel
        const aiButton = document.querySelector('.preview-tab[onclick*="ai-section"]');
        if (aiButton) switchPreviewPaneTab('ai-section', aiButton);
        // Force expand the right panel to default widths
        toggleRightPanel(true); // Ensure right panel is visible
    }
    
    updateFolderSectionVisibility(); 
}

codeEditor.addEventListener('input', function(e) {
    if (currentFile) {
        files[currentFile].content = codeEditor.value;
    }
    updateLineNumbers();
    
    // Auto-indent on Enter key
    autoIndentOnEnter(e.inputType);
    
    // Update preview if needed (only for web files)
    if (currentFile && ['html', 'css', 'js'].includes(getLanguageFromFileName(currentFile))) {
        updatePreview();
    }
});

function updateLineNumbers() {
    const lines = codeEditor.value.split('\n');
    lineNumbers.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
}

// Function to handle auto-indent on Enter key
function autoIndentOnEnter(inputType) {
    if (inputType !== 'insertLineBreak') return;

    const editor = codeEditor;
    const value = editor.value;
    const cursorPosition = editor.selectionStart;

    // Find the start of the current line (which is the new line just inserted)
    const lineStart = value.lastIndexOf('\n', cursorPosition - 2) + 1;
    const prevLine = value.substring(lineStart, cursorPosition - 1); 
    
    const prevLineIndentMatch = prevLine.match(/^\s*/);
    let indent = prevLineIndentMatch ? prevLineIndentMatch[0] : ''; // Carry over previous line's indent
    
    const prevLineTrimmed = prevLine.trim();

    // Add extra indent if previous line ends with an opening block character
    if (currentLanguage === 'html' && prevLineTrimmed.match(/<[^!/][^>]*[^/]>$/) && !prevLineTrimmed.match(/^(<[^!/][^>]*[^/]>.*<\/[^>]*>)$/) && !prevLineTrimmed.match(/<br>|<hr>|<img|<input|<link|<meta/i)) {
        indent += '    ';
    } else if (currentLanguage === 'css' && prevLineTrimmed.endsWith('{')) {
        indent += '    ';
    } else if ((currentLanguage === 'javascript' || currentLanguage === 'java' || currentLanguage === 'cpp') && (prevLineTrimmed.endsWith('{') || prevLineTrimmed.endsWith('['))) {
        indent += '    ';
    } else if (currentLanguage === 'python') {
        // Python-specific indentation rules
        if (prevLineTrimmed.endsWith(':')) {
            indent += '    '; // Indent after colon
        } else if (prevLineTrimmed.match(/^\s*(def|class|if|elif|else|for|while|try|except|finally|with)\b/)) {
            indent += '    '; // Indent after block start
        }
    }

    // Insert the indent for the new line
    editor.value = value.substring(0, cursorPosition) + indent + value.substring(cursorPosition);
    editor.selectionStart = editor.selectionEnd = cursorPosition + indent.length;
}

// Add tab key handling
codeEditor.addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
        e.preventDefault(); // Prevent default tab behavior
        
        const start = this.selectionStart;
        const end = this.selectionEnd;
        
        // If there's a selection, indent all selected lines
        if (start !== end) {
            const value = this.value;
            const lines = value.substring(start, end).split('\n');
            const indentedLines = lines.map(line => '    ' + line);
            this.value = value.substring(0, start) + indentedLines.join('\n') + value.substring(end);
            this.selectionStart = start;
            this.selectionEnd = start + indentedLines.join('\n').length;
        } else {
            // If no selection, just insert 4 spaces at cursor
            const value = this.value;
            this.value = value.substring(0, start) + '    ' + value.substring(end);
            this.selectionStart = this.selectionEnd = start + 4;
        }
    } else if (e.key === 'Backspace') {
        const start = this.selectionStart;
        const end = this.selectionEnd;
        
        // Only handle backspace if there's no selection and cursor is at start of line
        if (start === end) {
            const value = this.value;
            const lineStart = value.lastIndexOf('\n', start - 1) + 1;
            const currentLine = value.substring(lineStart, start);
            
            // Check if we're at the start of a line with only spaces before cursor
            if (currentLine.match(/^\s+$/) && currentLine.length > 0) {
                e.preventDefault();
                
                // Calculate how many spaces to remove (up to 4)
                const spacesToRemove = Math.min(4, currentLine.length);
                this.value = value.substring(0, start - spacesToRemove) + value.substring(start);
                this.selectionStart = this.selectionEnd = start - spacesToRemove;
            }
        }
    }
});

// Full code formatting function (for button click)
function formatCode() {
    const code = codeEditor.value;
    const language = currentLanguage;
    const indentChar = '    '; // 4 spaces

    const lines = code.split('\n');
    let indentLevel = 0;
    const formattedLines = [];

    lines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine === '') {
            formattedLines.push(''); // Preserve blank lines
            return;
        }

        // Logic for decreasing indentation based on language
        let dedentCurrentLine = false;
        if (language === 'html' && trimmedLine.match(/^<\//)) { // e.g., </div>
            dedentCurrentLine = true;
        } else if (language === 'css' && trimmedLine.startsWith('}')) {
            dedentCurrentLine = true;
        } else if ((language === 'javascript' || language === 'java' || language === 'cpp') && (trimmedLine.startsWith('}') || trimmedLine.startsWith(']'))) { // e.g., } or ]
            dedentCurrentLine = true;
        } else if (language === 'python' && trimmedLine.match(/^\s*(elif|else|except|finally)\b/)) { // Python dedent keywords
            dedentCurrentLine = true;
        }

        if (dedentCurrentLine) {
            indentLevel = Math.max(0, indentLevel - 1);
        }
        
        // Add current indent
        formattedLines.push(indentChar.repeat(indentLevel) + trimmedLine);
        
        // Logic for increasing indentation for the *next* line
        let indentNextLine = false;
        if (language === 'html' && trimmedLine.match(/<[^!/][^>]*[^/]>$/) && !trimmedLine.match(/^(<[^!/][^>]*[^/]>.*<\/[^>]*>)$/) && !trimmedLine.match(/<br>|<hr>|<img|<input|<link|<meta/i)) { // Opening HTML tag, not self-closing or paired on same line
            indentNextLine = true;
        } else if (language === 'css' && trimmedLine.endsWith('{')) {
            indentNextLine = true;
        } else if ((language === 'javascript' || language === 'java' || language === 'cpp') && (trimmedLine.endsWith('{') || trimmedLine.endsWith('[') || trimmedLine.endsWith(':'))) { // { or [ or : (for switch/object)
            indentNextLine = true;
        } else if (language === 'python' && trimmedLine.endsWith(':')) { // Python colon for block
            indentNextLine = true;
        }

        if (indentNextLine) {
            indentLevel++;
        }
    });
    
    codeEditor.value = formattedLines.join('\n');
    if (currentFile) {
        files[currentFile].content = codeEditor.value; // Update files object
    }
    updateLineNumbers();
    
    // Only update preview if it's a web-related file
    const fileExtension = currentFile ? getLanguageFromFileName(currentFile) : '';
    if (['html', 'css', 'js'].includes(fileExtension)) {
        updatePreview();
    }
}

codeEditor.addEventListener('scroll', function() {
    lineNumbers.scrollTop = this.scrollTop;
});

// Update AI prompt/response to use the correct elements
aiPrompt.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        askGemini();
    }
});

async function askGemini() {
    const prompt = document.getElementById('ai-prompt').value.trim();
    if (!prompt) return;

    // Check if API key is set
    if (!CONFIG.API.key) {
        const aiResponse = document.getElementById('ai-response');
        aiResponse.innerHTML = `
            <div class="error">
                <p><i class="fas fa-exclamation-circle"></i> Gemini API key not set!</p>
                <p>Please go to Settings and enter your Gemini API key to use the AI features.</p>
                <button onclick="openSettings()" class="settings-btn">
                    <i class="fas fa-cog"></i> Open Settings
                </button>
            </div>
        `;
        switchPreviewPaneTab('ai-section', document.querySelector('.preview-tab[onclick*="ai-section"]'));
        return;
    }

    const aiResponse = document.getElementById('ai-response');
    aiResponse.innerHTML = '<div class="loading">Thinking...</div>';
    switchPreviewPaneTab('ai-section', document.querySelector('.preview-tab[onclick*="ai-section"]'));

    // Check if this is a learning request
    const isLearningRequest = prompt.toLowerCase().includes('teach me') || 
                            prompt.toLowerCase().includes('learn') || 
                            prompt.toLowerCase().includes('tutorial') ||
                            prompt.toLowerCase().includes('guide');

    try {
        let systemPrompt = '';
        if (isLearningRequest) {
            // Get the current language or detect from prompt
            let targetLanguage = currentLanguage;
            
            // Common programming languages and their variations
            const languagePatterns = {
                'javascript': ['javascript', 'js', 'ecmascript'],
                'html': ['html', 'hypertext markup language'],
                'css': ['css', 'cascading style sheets'],
                'python': ['python', 'py'],
                'java': ['java'],
                'cpp': ['c++', 'cpp', 'c plus plus'],
                'rust': ['rust', 'rs'],
                'typescript': ['typescript', 'ts'],
                'ruby': ['ruby', 'rb'],
                'php': ['php'],
                'swift': ['swift'],
                'kotlin': ['kotlin', 'kt'],
                'go': ['go', 'golang'],
                'scala': ['scala'],
                'perl': ['perl', 'pl'],
                'r': ['r'],
                'matlab': ['matlab'],
                'sql': ['sql', 'mysql', 'postgresql', 'sqlite'],
                'bash': ['bash', 'shell', 'sh'],
                'powershell': ['powershell', 'ps'],
                'csharp': ['c#', 'csharp', 'dotnet'],
                'c': ['c'],
                'assembly': ['assembly', 'asm'],
                'fortran': ['fortran'],
                'cobol': ['cobol'],
                'pascal': ['pascal'],
                'lisp': ['lisp'],
                'prolog': ['prolog'],
                'haskell': ['haskell', 'hs'],
                'erlang': ['erlang'],
                'elixir': ['elixir'],
                'clojure': ['clojure', 'clj'],
                'fsharp': ['f#', 'fsharp'],
                'dart': ['dart'],
                'julia': ['julia'],
                'lua': ['lua'],
                'groovy': ['groovy'],
                'objective-c': ['objective-c', 'objc'],
                'r': ['r'],
                'scala': ['scala'],
                'scheme': ['scheme'],
                'smalltalk': ['smalltalk'],
                'tcl': ['tcl'],
                'vb': ['visual basic', 'vb', 'vb.net'],
                'xml': ['xml'],
                'yaml': ['yaml', 'yml'],
                'json': ['json'],
                'markdown': ['markdown', 'md']
            };

            // Check prompt for language keywords
            for (const [lang, patterns] of Object.entries(languagePatterns)) {
                if (patterns.some(pattern => prompt.toLowerCase().includes(pattern))) {
                    targetLanguage = lang;
                    break;
                }
            }

            systemPrompt = `You are a patient and knowledgeable programming teacher. When teaching ${targetLanguage}:
1. Focus on ONE concept at a time
2. Keep explanations concise and clear
3. Provide ONE practical example
4. Include ONE practice exercise
5. End with a "Next Step" suggestion
6. Format your response as follows:

## Current Topic: [Topic Name]
[Brief explanation of the concept]

### Example:
\`\`\`${targetLanguage}
[One clear example]
\`\`\`

### Practice:
[One simple practice exercise]

### Next Step:
[What to learn next]

Remember: Keep it focused and simple. Don't overwhelm the learner with multiple concepts at once.`;
        } else {
            systemPrompt = `You are a helpful coding assistant. Please help with this code-related question. Format your response using markdown for better readability. Use code blocks with language specification when showing code examples. Be concise but thorough.`;
        }

        const response = await fetch(`${CONFIG.API.endpoint}?key=${CONFIG.API.key}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `${systemPrompt}\n\nUser question: ${prompt}`
                    }]
                }]
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            const rawResponse = data.candidates[0].content.parts[0].text;
            
            // Create response container with toggle
            const responseContainer = document.createElement('div');
            responseContainer.className = 'response-container';
            
            // Add toggle buttons
            const toggleContainer = document.createElement('div');
            toggleContainer.className = 'response-toggle';
            toggleContainer.innerHTML = `
                <button class="toggle-btn active" onclick="toggleResponseView('formatted')">Formatted</button>
                <button class="toggle-btn" onclick="toggleResponseView('raw')">Raw</button>
            `;
            
            // Create formatted and raw response divs
            const formattedDiv = document.createElement('div');
            formattedDiv.className = 'formatted-response';
            formattedDiv.innerHTML = formatAIResponse(rawResponse);
            
            const rawDiv = document.createElement('div');
            rawDiv.className = 'raw-response';
            rawDiv.style.display = 'none';
            rawDiv.innerHTML = `<pre>${rawResponse}</pre>`;
            
            // Add "Next Topic" button for learning content
            if (isLearningRequest) {
                const nextTopicButton = document.createElement('button');
                nextTopicButton.className = 'next-topic-btn';
                nextTopicButton.innerHTML = '<i class="fas fa-arrow-right"></i> Continue to Next Topic';
                nextTopicButton.onclick = () => {
                    const nextStepMatch = rawResponse.match(/### Next Step:\s*([^\n]+)/);
                    if (nextStepMatch) {
                        document.getElementById('ai-prompt').value = `Teach me about ${nextStepMatch[1]}`;
                        askGemini();
                    }
                };
                formattedDiv.appendChild(nextTopicButton);
            }
            
            // Assemble the response
            responseContainer.appendChild(toggleContainer);
            responseContainer.appendChild(formattedDiv);
            responseContainer.appendChild(rawDiv);
            aiResponse.innerHTML = '';
            aiResponse.appendChild(responseContainer);
        } else {
            throw new Error('Invalid response format from API');
        }
    } catch (error) {
        console.error('Error calling Gemini API:', error);
        aiResponse.innerHTML = `<div class="error">
            <p>Error getting response from AI:</p>
            <p>${error.message}</p>
        </div>`;
    }

    document.getElementById('ai-prompt').value = '';
}

function toggleResponseView(view) {
    const formattedDiv = document.querySelector('.formatted-response');
    const rawDiv = document.querySelector('.raw-response');
    const buttons = document.querySelectorAll('.toggle-btn');
    
    if (view === 'raw') {
        formattedDiv.style.display = 'none';
        rawDiv.style.display = 'block';
        buttons[0].classList.remove('active');
        buttons[1].classList.add('active');
    } else {
        formattedDiv.style.display = 'block';
        rawDiv.style.display = 'none';
        buttons[0].classList.add('active');
        buttons[1].classList.remove('active');
    }
}

// Update the formatAIResponse function to handle learning content better
function formatAIResponse(text) {
    // Split the text into sections based on headings
    const sections = text.split(/(?=^#\s+)/m);
    let formattedSections = [];

    sections.forEach(section => {
        if (!section.trim()) return;

        // Handle code blocks with language specification
        let formattedSection = section.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, language, code) => {
            const lines = code.split('\n');
            const minIndent = Math.min(...lines
                .filter(line => line.trim())
                .map(line => line.match(/^\s*/)[0].length)
            );
            const cleanedCode = lines
                .map(line => line.slice(minIndent))
                .join('\n')
                .trim();
            
            const langClass = language ? ` class="language-${language}"` : '';
            return `<div class="code-block">
                <div class="code-header">${language || 'Code'}</div>
                <pre><code${langClass}>${cleanedCode}</code></pre>
            </div>`;
        });

        // Handle inline code
        formattedSection = formattedSection.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Handle headings with navigation IDs
        formattedSection = formattedSection.replace(/^#\s+(.+)$/gm, '<h1 id="section-${formattedSections.length}">$1</h1>');
        formattedSection = formattedSection.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        formattedSection = formattedSection.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');

        // Handle lists
        formattedSection = formattedSection.replace(/^\s*([*-]|\d+\.)\s+(.+)$/gm, (match, type, content) => {
            return `<li>${content}</li>`;
        });
        
        formattedSection = formattedSection.replace(/(<li>.+?<\/li>(\s*<li>.+?<\/li>)*)/gs, (match) => {
            if (match.match(/^\s*\d+\.\s+/m)) {
                return `<ol>${match}</ol>`;
            }
            return `<ul>${match}</ul>`;
        });

        // Handle special sections
        formattedSection = formattedSection.replace(/^Exercise:\s*(.+)$/gm, 
            '<div class="special-section exercise"><i class="fas fa-tasks"></i><strong>Exercise:</strong> $1</div>');
        formattedSection = formattedSection.replace(/^Practice:\s*(.+)$/gm, 
            '<div class="special-section practice"><i class="fas fa-code"></i><strong>Practice:</strong> $1</div>');
        formattedSection = formattedSection.replace(/^Tip:\s*(.+)$/gm, 
            '<div class="special-section tip"><i class="fas fa-lightbulb"></i><strong>Tip:</strong> $1</div>');
        formattedSection = formattedSection.replace(/^Note:\s*(.+)$/gm, 
            '<div class="special-section note"><i class="fas fa-info-circle"></i><strong>Note:</strong> $1</div>');

        // Handle paragraphs
        formattedSection = formattedSection.split('\n\n').map(p => {
            if (p.startsWith('<div') || p.startsWith('<pre>') || p.startsWith('<ul>') || 
                p.startsWith('<ol>') || p.startsWith('<h') || p.trim() === '') {
                return p;
            }
            return `<p>${p}</p>`;
        }).join('');

        // Handle links
        formattedSection = formattedSection.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 
            '<a href="$2" target="_blank" class="content-link"><i class="fas fa-external-link-alt"></i> $1</a>');

        // Handle blockquotes
        formattedSection = formattedSection.replace(/^>\s+(.+)$/gm, 
            '<blockquote><i class="fas fa-quote-left"></i>$1</blockquote>');

        formattedSections.push(formattedSection);
    });

    // Create navigation if there are multiple sections
    let navigation = '';
    if (sections.length > 1) {
        navigation = '<div class="content-nav"><h4>Quick Navigation:</h4><ul>' +
            sections.map((section, index) => {
                const heading = section.match(/^#\s+(.+)$/m);
                if (heading) {
                    return `<li><a href="#section-${index}">${heading[1]}</a></li>`;
                }
                return '';
            }).filter(Boolean).join('') +
            '</ul></div>';
    }

    // Combine everything
    return `<div class="formatted-content">
        ${navigation}
        ${formattedSections.join('')}
    </div>`;
}

async function requestHelp() {
    const code = currentFile && files[currentFile] ? files[currentFile].content : '';
    if (!code.trim() && !confirm("No code written. Do you want to describe what you want to achieve?")) {
        document.getElementById('ai-response').innerHTML = 'Please write some code or describe your goal in the input field.';
        switchPreviewPaneTab('ai-section', document.querySelector('.preview-tab[onclick*="ai-section"]'));
        return;
    }
    
    document.getElementById('ai-response').innerHTML = 'Thinking...';
    switchPreviewPaneTab('ai-section', document.querySelector('.preview-tab[onclick*="ai-section"]'));
    
    // Pre-fill the prompt for the user
    const defaultHelpPrompt = `I need help with my current ${currentLanguage} code. Can you analyze it and suggest the next step or a common improvement?

My current code:
\`\`\`${currentLanguage}
${code}
\`\`\``;
    document.getElementById('ai-prompt').value = defaultHelpPrompt;
    askGemini();
}

// Optionally hide the second folder section if no folder is open
function updateFolderSectionVisibility() {
    const folderSection = document.querySelectorAll('.file-tree-item.folder-root')[1];
    if (openedDirectoryHandle) {
        folderSection.style.display = '';
    } else {
        folderSection.style.display = 'none';
    }
}

async function openFolderPicker() {
    try {
        openedDirectoryHandle = await window.showDirectoryPicker();
        openedFolderName.textContent = openedDirectoryHandle.name.toUpperCase();
        document.querySelector('#file-tree .folder-root:nth-child(2)').classList.add('expanded');
        await listDirectoryContents(openedDirectoryHandle, directoryFilesList, openedDirectoryHandle.name);
        updateFolderSectionVisibility(); // Hide/show folder section
        // Optional: Request persistence for the directory handle (experimental, requires user permission)
        if (navigator.storage && navigator.storage.persist) {
            const persisted = await navigator.storage.persist();
            if (persisted) {
                console.log("Storage will persist for this origin.");
            } else {
                console.warn("Storage will not persist. User must grant permission again on next visit.");
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log('User cancelled folder picker.');
        } else {
            console.error('Error opening folder:', err);
            alert('Failed to open folder: ' + err.message);
        }
    }
}

function updatePreview() {
    if (!currentFile) return;

    const fileExtension = getLanguageFromFileName(currentFile);
    if (!['html', 'css', 'js'].includes(fileExtension)) return;

    // Get all relevant files
    let htmlContent = '';
    let cssContent = '';
    let jsContent = '';

    // Find the HTML file content
    if (fileExtension === 'html') {
        htmlContent = files[currentFile].content;
    } else {
        // Look for an HTML file in the open files
        const htmlFile = Object.keys(files).find(file => getLanguageFromFileName(file) === 'html');
        if (htmlFile) {
            htmlContent = files[htmlFile].content;
        } else {
            // If no HTML file found, create a basic template
            htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Preview</title>
</head>
<body>
</body>
</html>`;
        }
    }

    // Find CSS content
    const cssFile = Object.keys(files).find(file => getLanguageFromFileName(file) === 'css');
    if (cssFile) {
        cssContent = files[cssFile].content;
    }

    // Find JavaScript content
    const jsFile = Object.keys(files).find(file => getLanguageFromFileName(file) === 'js');
    if (jsFile) {
        jsContent = files[jsFile].content;
    }

    // Combine all content
    let finalHtml = htmlContent;
    
    // Add CSS if exists
    if (cssContent) {
        const styleTag = `<style>${cssContent}</style>`;
        if (finalHtml.includes('</head>')) {
            finalHtml = finalHtml.replace('</head>', `${styleTag}</head>`);
        } else {
            finalHtml = finalHtml.replace('<body>', `${styleTag}<body>`);
        }
    }

    // Add JavaScript if exists
    if (jsContent) {
        const scriptTag = `<script>${jsContent}</script>`;
        finalHtml = finalHtml.replace('</body>', `${scriptTag}</body>`);
    }

    // Create a blob URL for the HTML content
    const blob = new Blob([finalHtml], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    // Update the preview iframe with the blob URL
    const previewFrame = document.getElementById('preview-frame');
    if (previewFrame) {
        previewFrame.src = blobUrl;
        
        // Clean up the blob URL after the iframe loads
        previewFrame.onload = () => {
            URL.revokeObjectURL(blobUrl);
            
            // Handle any errors in the preview
            try {
                const frameWindow = previewFrame.contentWindow;
                if (frameWindow.document.body.innerHTML === '') {
                    frameWindow.document.body.innerHTML = '<div style="color: #666; padding: 20px;">No preview available</div>';
                }
            } catch (error) {
                console.error('Preview error:', error);
            }
        };
    }
}

// Add a function to handle file paths
function getRelativePath(filePath) {
    if (!openedDirectoryHandle) return filePath;
    
    const basePath = openedDirectoryHandle.name;
    if (filePath.startsWith(basePath)) {
        return filePath.substring(basePath.length + 1);
    }
    return filePath;
}

// Resize functionality
let isResizing = false;
let startX;
let startWidth;

// Add these variables at the top with other state variables
let lastEditorWidth = '50%';
let lastPreviewWidth = '50%';

resizer.addEventListener('mousedown', initResize);
document.addEventListener('mousemove', resize);
document.addEventListener('mouseup', stopResize);

function initResize(e) {
    e.preventDefault(); // Prevent text selection
    isResizing = true;
    startX = e.clientX;
    startWidth = parseInt(getComputedStyle(editorContainer).width);
    
    // Add resizing class for visual feedback
    resizer.classList.add('resizing');
    
    // Prevent text selection during resize
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
}

function resize(e) {
    if (!isResizing) return;
    e.preventDefault();

    const containerWidth = editorAndRightPanelContainer.offsetWidth;
    const minWidth = 200;
    const resizerWidth = resizer.offsetWidth;
    
    // Calculate new width based on mouse movement
    const deltaX = e.clientX - startX;
    const newWidth = Math.max(minWidth, Math.min(containerWidth - minWidth - resizerWidth, startWidth + deltaX));
    
    // Update widths
    const newEditorWidth = `${newWidth}px`;
    const newPreviewWidth = `${containerWidth - newWidth - resizerWidth}px`;
    
    editorContainer.style.width = newEditorWidth;
    previewContainer.style.width = newPreviewWidth;
    
    // Store the last widths
    lastEditorWidth = newEditorWidth;
    lastPreviewWidth = newPreviewWidth;
}

function stopResize(e) {
    if (!isResizing) return;
    e.preventDefault();
    
    isResizing = false;
    resizer.classList.remove('resizing');
    
    // Reset cursor and selection
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
}

// Add CSS for the terminal-like output
const style = document.createElement('style');
style.textContent = `
#output-section {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1e1e1e;
    padding: 0;
    position: relative;
}

.output-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
}

#output-console {
    flex: 1;
    padding: 10px;
    background: #1e1e1e;
    color: #fff;
    font-family: 'Consolas', 'Monaco', monospace;
    white-space: pre-wrap;
    overflow-y: auto;
    min-height: 100px;
    border: none;
    outline: none;
    resize: none;
    line-height: 1.5;
    tab-size: 4;
}

.terminal-line {
    display: flex;
    align-items: flex-start;
    margin: 2px 0;
    min-height: 1.5em;
}

.terminal-prompt {
    color: #4CAF50;
    margin-right: 8px;
    user-select: none;
}

.terminal-input {
    flex: 1;
    background: transparent;
    border: none;
    color: #fff;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: inherit;
    padding: 0;
    margin: 0;
    outline: none;
    caret-color: #fff;
    white-space: pre-wrap;
    word-break: break-all;
}

.terminal-input:focus {
    outline: none;
}

.terminal-text {
    color: #fff;
}

.terminal-error {
    color: #ff6b6b;
}

.terminal-success {
    color: #4CAF50;
}

.terminal-cursor {
    display: inline-block;
    width: 2px;
    height: 1.2em;
    background: #fff;
    margin-left: 2px;
    animation: blink 1s infinite;
}

@keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
}

.terminal-history {
    color: #858585;
}
`;

document.head.appendChild(style);

// Terminal state
let terminalHistory = [];
let historyIndex = -1;
let currentInput = '';
let isProcessing = false;

// Update the output section structure
function updateOutputSection() {
    const outputSection = document.getElementById('output-section');
    if (!outputSection.querySelector('.output-container')) {
        const container = document.createElement('div');
        container.className = 'output-container';
        
        // Make output console editable
        outputConsole.contentEditable = true;
        outputConsole.spellcheck = false;
        outputConsole.className = 'output-console';
        
        // Add event listeners for terminal-like behavior
        outputConsole.addEventListener('keydown', handleTerminalKeyDown);
        outputConsole.addEventListener('input', handleTerminalInput);
        
        container.appendChild(outputConsole);
        outputSection.appendChild(container);
    }
}

// Handle terminal key events
function handleTerminalKeyDown(event) {
    if (isProcessing) {
        event.preventDefault();
        return;
    }

    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const line = range.startContainer.parentElement;

    if (!line.classList.contains('terminal-line')) {
        event.preventDefault();
        return;
    }

    const input = line.querySelector('.terminal-input');
    if (!input) {
        event.preventDefault();
        return;
    }

    switch (event.key) {
        case 'Enter':
            if (!event.shiftKey) {
                event.preventDefault();
                const value = input.textContent;
                if (value.trim()) {
                    terminalHistory.push(value);
                    historyIndex = terminalHistory.length;
                }
                input.contentEditable = false;
                input.classList.add('terminal-text');
                processTerminalInput(value);
            }
            break;

        case 'ArrowUp':
            event.preventDefault();
            if (historyIndex > 0) {
                historyIndex--;
                input.textContent = terminalHistory[historyIndex];
            }
            break;

        case 'ArrowDown':
            event.preventDefault();
            if (historyIndex < terminalHistory.length - 1) {
                historyIndex++;
                input.textContent = terminalHistory[historyIndex];
            } else {
                historyIndex = terminalHistory.length;
                input.textContent = '';
            }
            break;

        case 'Tab':
            event.preventDefault();
            input.textContent += '    ';
            break;
    }
}

// Handle terminal input
function handleTerminalInput(event) {
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const line = range.startContainer.parentElement;

    if (line.classList.contains('terminal-line')) {
        const input = line.querySelector('.terminal-input');
        if (input) {
            currentInput = input.textContent;
        }
    }
}

// Place cursor at end of input
function placeCursorAtEnd(element) {
    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
}

// Process terminal input
async function processTerminalInput(value) {
    isProcessing = true;
    const language = currentLanguage;

    if (['python', 'java', 'cpp'].includes(language)) {
        try {
            const languageId = CONFIG.JUDGE0.languages[language] || 71;
            
            // Submit new code with input
            const response = await fetch('https://judge0-ce.p.rapidapi.com/submissions', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'X-RapidAPI-Host': CONFIG.JUDGE0.host,
                    'X-RapidAPI-Key': CONFIG.JUDGE0.key
                },
                body: JSON.stringify({
                    language_id: languageId,
                    source_code: codeEditor.value,
                    stdin: value + '\n'
                })
            });

            const { token } = await response.json();

            // Poll for results
            let result;
            do {
                await new Promise(resolve => setTimeout(resolve, 1000));
                const resultResponse = await fetch(`https://judge0-ce.p.rapidapi.com/submissions/${token}`, {
                    headers: {
                        'X-RapidAPI-Host': CONFIG.JUDGE0.host,
                        'X-RapidAPI-Key': CONFIG.JUDGE0.key
                    }
                });
                result = await resultResponse.json();
            } while (result.status.id <= 2);

            // Display results
            if (result.stdout) {
                appendTerminalOutput(result.stdout);
                // Check if we need another input
                if (result.stdout.includes('input') || result.stdout.includes('Enter') || result.stdout.includes(':')) {
                    createTerminalInput();
                }
            } else if (result.stderr) {
                appendTerminalError(result.stderr);
            } else if (result.compile_output) {
                appendTerminalError(`Compilation Error:\n${result.compile_output}`);
            }
        } catch (error) {
            appendTerminalError(`Execution Error: ${error.message}`);
        }
    }
    isProcessing = false;
}

// Function to create a new terminal input line
function createTerminalInput(prompt = '') {
    const lineDiv = document.createElement('div');
    lineDiv.className = 'terminal-line';
    lineDiv.innerHTML = `
        <span class="terminal-prompt">${prompt ? prompt + ' ' : '>'}</span>
        <span class="terminal-input" contenteditable="true" spellcheck="false"></span>
        <span class="terminal-cursor"></span>
    `;
    outputConsole.appendChild(lineDiv);
    
    const input = lineDiv.querySelector('.terminal-input');
    input.focus();
    
    outputConsole.scrollTop = outputConsole.scrollHeight;
}

// Call this when the page loads
document.addEventListener('DOMContentLoaded', function() {
    // Initialize preview tabs (Preview, AI Chat, Output)
    const previewTabs = document.querySelectorAll('.preview-tab');
    previewTabs.forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            const sectionId = this.getAttribute('onclick').match(/'([^']+)'/)[1];
            switchPreviewPaneTab(sectionId, this);
        });
    });

    // Event Delegation for File Tree (Folder Collapse/Expand)
    const fileTreeContainer = document.getElementById('file-tree');
    if (fileTreeContainer) {
        fileTreeContainer.addEventListener('click', function(e) {
            const folderNameSpan = e.target.closest('.folder-name');
            const folderToggleIcon = e.target.closest('.folder-toggle');
            let folderRootToToggle = null;

            if (folderNameSpan) {
                folderRootToToggle = folderNameSpan.closest('.folder-root');
            } else if (folderToggleIcon) {
                folderRootToToggle = folderToggleIcon.closest('.folder-root');
            }

            if (folderRootToToggle && !folderToggleIcon) { // Click on folder name, not just toggle icon
                folderRootToToggle.classList.toggle('expanded');
                // If it's a folder-root and not an 'open files' folder, and it's expanding, list contents
                if (folderRootToToggle.classList.contains('expanded') && folderRootToToggle.id !== 'open-files-list-container') {
                    // Check if content already loaded or fetch from handle
                    const folderPath = folderRootToToggle.getAttribute('data-path');
                    const folderHandle = openedDirectoryHandle; // Assuming we're dealing with the single openedDirectoryHandle
                    if (folderHandle && folderPath.startsWith(folderHandle.name)) {
                        listDirectoryContents(openedDirectoryHandle, directoryFilesList, openedDirectoryHandle.name);
                    }
                }
            }
        });
    }

    updateOutputSection();
    loadInitialFilesAndState();
});

function switchPreviewPaneTab(sectionId, clickedButton) {
    // Update tab buttons
    document.querySelectorAll('.preview-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    clickedButton.classList.add('active');

    // Hide all sections
    document.querySelectorAll('.preview-section').forEach(section => {
        section.classList.remove('active');
        section.style.display = 'none'; 
    });
    
    // Show target section
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.style.display = 'flex'; // Use flex for all preview sections
        targetSection.classList.add('active');
        
        // Update preview if switching to preview tab
        if (sectionId === 'preview-section' && currentFile && ['html', 'css', 'js'].includes(getLanguageFromFileName(currentFile))) {
            updatePreview();
        }
    }
}

// Settings Modal Functions
function openSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.add('active');
    
    // Load current API keys from localStorage
    const geminiApiKey = localStorage.getItem('geminiApiKey') || CONFIG.API.key;
    const judge0ApiKey = localStorage.getItem('judge0ApiKey') || CONFIG.JUDGE0.key;
    
    document.getElementById('gemini-api-key').value = geminiApiKey;
    document.getElementById('judge0-api-key').value = judge0ApiKey;
}

function closeSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('active');
}

function toggleApiKeyVisibility() {
    const apiKeyInput = document.getElementById('gemini-api-key');
    const icon = apiKeyInput.nextElementSibling.querySelector('i');
    
    if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        apiKeyInput.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

function toggleJudge0ApiKeyVisibility() {
    const input = document.getElementById('judge0-api-key');
    const button = input.nextElementSibling.querySelector('i');
    
    if (input.type === 'password') {
        input.type = 'text';
        button.classList.remove('fa-eye');
        button.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        button.classList.remove('fa-eye-slash');
        button.classList.add('fa-eye');
    }
}

function saveSettings() {
    const geminiApiKey = document.getElementById('gemini-api-key').value.trim();
    
    if (!geminiApiKey) {
        alert('Please enter your Gemini API key');
        return;
    }
    
    // Save API key to localStorage
    localStorage.setItem('geminiApiKey', geminiApiKey);
    
    // Update CONFIG
    CONFIG.API.key = geminiApiKey;
    
    // Close settings modal
    document.getElementById('settings-modal').style.display = 'none';
    
    // Show success message
    const successMessage = document.createElement('div');
    successMessage.className = 'success-message';
    successMessage.innerHTML = `
        <i class="fas fa-check-circle"></i>
        <span>Settings saved successfully!</span>
    `;
    document.body.appendChild(successMessage);
    
    // Remove success message after 3 seconds
    setTimeout(() => {
        successMessage.remove();
    }, 3000);
}

function loadSettings() {
    const geminiApiKey = localStorage.getItem('geminiApiKey') || '';
    document.getElementById('gemini-api-key').value = geminiApiKey;
}