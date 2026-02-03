// --- 1. CREATE THE FLOATING UI PANEL ---
const panel = document.createElement('div');
panel.innerHTML = `
  <div style="position: fixed; top: 10px; right: 10px; width: 300px; background: #222; color: #fff; padding: 15px; z-index: 99999; border-radius: 8px; font-family: sans-serif; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
    <h3 style="margin: 0 0 10px 0; color: #0f0;">ECI Auto-Filler</h3>
    
    <label style="display:block; margin-bottom:5px;">1. Group Photo:</label>
    <input type="file" id="ext_group_photo" style="margin-bottom: 10px; width: 100%;">
    
    <label style="display:block; margin-bottom:5px;">2. Attendance PDF:</label>
    <input type="file" id="ext_attendance" style="margin-bottom: 10px; width: 100%;">
    
    <label style="display:block; margin-bottom:5px;">3. SIR PDF (Optional):</label>
    <input type="file" id="ext_sir" style="margin-bottom: 5px; width: 100%;">
    
    <div style="margin-bottom: 5px;">
        <input type="checkbox" id="ext_auto_submit">
        <label for="ext_auto_submit" style="display:inline; font-weight:normal;">Auto-Submit when ready</label>
    </div>
    
    <div style="margin-bottom: 15px;">
        <input type="checkbox" id="ext_loop_mode">
        <label for="ext_loop_mode" style="display:inline; font-weight:normal;">Loop Mode (Continuous)</label>
    </div>
    
    <button id="ext_start_btn" style="width: 100%; padding: 10px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 10px;">
      START (OPEN FORM)
    </button>

    <button id="ext_run_btn" style="width: 100%; padding: 10px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 10px;">
      RUN ON CURRENT FORM
    </button>
    
    <button id="ext_stop_btn" style="width: 100%; padding: 10px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
      STOP
    </button>

    <div id="ext_status" style="margin-top: 10px; font-size: 12px; color: #aaa;">Ready to start...</div>
  </div>
`;

document.body.appendChild(panel);

// Toggle Visibility on Message
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "toggle_panel") {
        if (panel.style.display === "none") {
            panel.style.display = "block";
        } else {
            panel.style.display = "none";
        }
    }
});

// --- 2. HELPER FUNCTIONS ---

let isStopRequested = false;

function updateStatus(msg) {
    const el = document.getElementById('ext_status');
    if (el) el.innerText = msg;
    console.log('[ECI Bot]', msg);
}

// Function to simulate file upload
function uploadFileToInput(inputId, fileObj) {
    const input = document.evaluate(inputId, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (!input) return false;

    // This is the trick to programmatically set files
    const dt = new DataTransfer();
    dt.items.add(fileObj);
    input.files = dt.files;

    // Trigger events so the website knows a file changed
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

// Function to click elements by XPath
function clickByXPath(xpath) {
    const el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (el) {
        el.click();
        return true;
    }
    return false;
}

// Function to check if an element exists
function elementExists(xpath) {
    return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

// Helper to wait (promisified setTimeout)
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Check if modal is visible
function isModalVisible() {
    const modal = document.getElementById('customModal');
    return modal && (modal.style.display !== 'none' && modal.offsetWidth > 0 && modal.offsetHeight > 0);
}

// --- 3. MAIN AUTOMATION LOGIC ---

document.getElementById('ext_start_btn').addEventListener('click', async () => {
    isStopRequested = false;
    const loopMode = document.getElementById('ext_loop_mode').checked;

    if (loopMode) {
        await runLoop();
    } else {
        await processCycle();
    }
});

document.getElementById('ext_stop_btn').addEventListener('click', () => {
    isStopRequested = true;
    updateStatus("STOPPING... (Will finish current step)");
});

async function runLoop() {
    let active = true;
    while (active) {
        if (isStopRequested) {
            updateStatus("LOOP STOPPED by user.");
            active = false;
            break;
        }

        updateStatus("LOOP: Starting new cycle...");
        const success = await processCycle();

        if (isStopRequested) {
            updateStatus("LOOP STOPPED by user.");
            active = false;
            break;
        }

        if (!success) {
            updateStatus("LOOP DONE: No more items or error.");
            active = false;
            break;
        }

        updateStatus("LOOP: Waiting for Modal to Close...");
        // Wait for modal to disappear
        let checks = 0;
        while (isModalVisible() && checks < 60) { // Wait up to 30s for close
            if (isStopRequested) {
                updateStatus("LOOP STOPPED by user.");
                return;
            }
            await wait(500);
            checks++;
        }

        updateStatus("LOOP: Modal closed. Cooling down (2s)...");
        await wait(2000); // Pause before next iteration
    }
}


// Core Process: Find Button -> Open -> Auto-Fill -> Submit
async function processCycle() {
    if (isStopRequested) return false;

    updateStatus("Looking for 'Take Action' button...");

    // Try to find the icon by title="Take Action"
    let actionBtn = document.evaluate('//i[@title="Take Action"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

    // Fallback: try by class if title fails
    if (!actionBtn) {
        actionBtn = document.evaluate('//i[contains(@class, "fa-arrow-up-from-bracket")]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    }

    if (actionBtn) {
        actionBtn.click();
        updateStatus("Clicked 'Take Action'. Waiting for form to load...");

        // Wait for the form to appear (Check for "Yes" button)
        let formLoaded = false;
        for (let i = 0; i < 20; i++) { // Wait up to 10 seconds
            if (isStopRequested) return false;
            if (elementExists('//*[@id="Y"]')) {
                formLoaded = true;
                break;
            }
            await wait(500);
        }

        if (formLoaded) {
            if (isStopRequested) return false;
            updateStatus("Form loaded! Starting automation...");
            await runAutomation();
            return true; // Success
        } else {
            updateStatus("Error: Form did not load in time.");
            return false;
        }

    } else {
        updateStatus("Error: Could not find 'Take Action' button!");
        // alert("Could not find any 'Take Action' icon on this page."); // Disable alert for loop
        return false;
    }
}

document.getElementById('ext_run_btn').addEventListener('click', () => {
    isStopRequested = false;
    runAutomation();
});

async function runAutomation() {
    const statusDiv = document.getElementById('ext_status');

    // Get the files selected in OUR panel
    const groupFile = document.getElementById('ext_group_photo').files[0];
    const attendanceFile = document.getElementById('ext_attendance').files[0];
    const sirFile = document.getElementById('ext_sir').files[0];

    if (!groupFile || !attendanceFile) {
        updateStatus("Error: Please select Group Photo and Attendance files first!");
        return;
    }

    try {
        updateStatus("Starting... 1. Clicking YES");
        // 1. Elector Present -> YES
        if (!clickByXPath('//*[@id="Y"]')) throw "Could not find YES button";
        await wait(500);

        updateStatus("2. Clicking NOW (Upload Docs)");
        // 2. Select 'Now' to upload additional documents (2nd 'Y' button)
        clickByXPath('(//*[@id="Y"])[2]');
        await wait(500);

        updateStatus("3. Uploading Group Photo...");
        // 3. Upload Group Photo
        uploadFileToInput('//*[@id="doc_photo"]', groupFile);

        // Wait for Success Icon (Relative XPath: First button/icon after the input)
        updateStatus("Waiting for Photo verification...");
        let retries = 0;
        // Search for <i> inside a <button> that follows the input
        while (!elementExists('//input[@id="doc_photo"]/following::button[1]/i')) {
            await wait(1000);
            retries++;
            if (retries > 30) throw "Timeout waiting for Group Photo upload";
        }

        updateStatus("4. Uploading Attendance...");
        // 4. Upload Attendance
        uploadFileToInput('//*[@id="doc_attendanceSheet"]', attendanceFile);

        updateStatus("Waiting for Attendance verification...");
        retries = 0;
        while (!elementExists('//input[@id="doc_attendanceSheet"]/following::button[1]/i')) {
            await wait(1000);
            retries++;
            if (retries > 30) throw "Timeout waiting for Attendance upload";
        }

        // 5. SIR Check (Front)
        updateStatus("5. Checking for SIR field (Front)...");
        // Changing target to Front based on user request
        const sirInput = elementExists('//*[@id="doc_lastSirFront"]');

        if (sirInput && sirInput.offsetParent !== null) { // Check if visible
            if (!sirFile) throw "SIR Field is present but you didn't select a SIR file in the panel!";

            updateStatus("SIR Field found. Uploading to Front...");
            uploadFileToInput('//*[@id="doc_lastSirFront"]', sirFile);

            // Wait for SIR Success (Relative to Front input)
            while (!elementExists('//input[@id="doc_lastSirFront"]/following::button[1]/i')) {
                await wait(1000);
            }
        } else {
            updateStatus("SIR Field not found. Clicking Additional Docs NO...");
            // Click the LAST 'No' button on the page
            const noButtons = document.evaluate('//*[@id="N"]', document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            if (noButtons.snapshotLength > 0) {
                noButtons.snapshotItem(noButtons.snapshotLength - 1).click();
            }
        }
        await wait(500);

        updateStatus("6. Setting Found OK...");
        // Try original ID first
        if (!clickByXPath('//*[@id="updateInFinalPublicationFlag"]')) {
            console.log("ID for Found OK failed, trying text search...");
            // Fallback: Click the Label containing "Found OK"
            const foundBtn = document.evaluate('//label[contains(text(), "Found OK")]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (foundBtn) {
                foundBtn.click();
                updateStatus("Clicked 'Found OK' via text.");
            } else {
                console.warn("Could not find 'Found OK' button!");
            }
        }
        await wait(200);

        updateStatus("7. Writing Remarks...");

        // Strategy 1: User provided XPath
        let textarea = document.evaluate('//*[@id="customModal"]/div/div[2]/div/div[11]/div[3]/div[1]/div/textarea', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

        // Strategy 2: Fallback to any textarea in the modal if strict path fails
        if (!textarea) {
            console.log("Strict path for remarks failing, trying generic textarea search...");
            textarea = document.evaluate('//textarea', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        }

        if (textarea) {
            textarea.value = "ok";
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            updateStatus("Remarks written.");
        } else {
            console.warn("Remarks textarea not found via any method!");
            updateStatus("Warning: Could not find Remarks box.");
        }

        // Wait for potential validation/UI updates
        await wait(500);

        updateStatus("8. Focusing SUBMIT button...");
        let submitBtn = null;
        let submitRetries = 0;

        while (!submitBtn && submitRetries < 20) { // Increased to 20 retries (10s)

            // Safety: Ensure 'Found OK' is still checked (sometimes it unchecks if logic is weird)
            const foundRadio = document.querySelector('#updateInFinalPublicationFlag');
            if (foundRadio && foundRadio.offsetParent !== null && !foundRadio.checked) { // Check if visible and not checked
                console.log("Re-clicking Found OK...");
                foundRadio.click();
            }

            // 1. Try User's Specific XPath
            submitBtn = document.evaluate('//*[@id="customModal"]/div/div[2]/div/div[13]/button', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

            // 2. Fallback: robust text-based XPath (Case Insensitive)
            if (!submitBtn) {
                submitBtn = document.evaluate('//button[translate(normalize-space(text()), "SUBMIT", "submit")="submit"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            }

            // 3. Fallback: Any button with "Submit" in text
            if (!submitBtn) {
                submitBtn = document.evaluate('//button[contains(translate(text(), "S", "s"), "submit")]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            }

            // 4. Fallback: Last button in the modal (Risky but effective)
            if (!submitBtn) {
                // Find all buttons in modal
                const modalButtons = document.evaluate('//*[@id="customModal"]//button', document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                if (modalButtons.snapshotLength > 0) {
                    // Log them for debugging
                    console.log(`Found ${modalButtons.snapshotLength} buttons in modal.`);
                    // Assume the last one is Submit
                    const candidate = modalButtons.snapshotItem(modalButtons.snapshotLength - 1);
                    if (candidate.innerText.toUpperCase().includes("SUBMIT")) {
                        submitBtn = candidate;
                    }
                }
            }

            if (!submitBtn) {
                await wait(500);
                submitRetries++;
                if (submitRetries % 2 === 0) updateStatus(`Searching for Submit button... (${submitRetries / 2}s)`);
            }
        }

        if (submitBtn) {
            submitBtn.focus();
            submitBtn.scrollIntoView({ behavior: "smooth", block: "center" });

            // Highlight it visually so user knows
            submitBtn.style.border = "3px solid red";
            submitBtn.style.boxShadow = "0 0 10px red";

            // CHECK AUTO-SUBMIT SWITCH
            const autoSubmit = document.getElementById('ext_auto_submit').checked;
            if (autoSubmit) {
                updateStatus("Auto-Submit ENABLED. Checking validation...");

                // 1. Wait for "Please fill required fields" text to disappear (User Feedback)
                // Increased wait to 60 * 500ms = 30 seconds
                for (let k = 0; k < 60; k++) {
                    const errorMsg = document.evaluate('//*[contains(text(), "Please fill the required fields")]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    if (!errorMsg || errorMsg.offsetParent === null) {
                        // Element not found or hidden
                        break;
                    }
                    if (k === 0) updateStatus("Waiting for red validation text to vanish...");
                    await wait(500);
                }

                updateStatus("Waiting for Submit button to enable...");
                // 2. Wait for button to enable (up to 5s)
                for (let i = 0; i < 10; i++) {
                    if (!submitBtn.disabled) break;
                    await wait(500);
                }

                if (submitBtn.disabled) {
                    updateStatus("Warning: Submit button is still DISABLED! Cannot click.");
                } else {
                    updateStatus("Button enabled! Clicking...");
                    // Robust click simulation: Dispatch events in case .click() isn't enough
                    submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    submitBtn.click();
                    updateStatus("DONE! Form Submitted (Simulated Click).");
                }
            } else {
                updateStatus("DONE! Submit button found & focused (Auto-Submit OFF).");
            }

        } else {
            console.warn("Submit button not found via ANY method after retries!");
            updateStatus("Warning: Submit button not found. Check Console.");

            // Debug: Log all buttons on page
            const allBtns = document.getElementsByTagName('button');
            console.log("--- DEBUG: ALL BUTTONS ---");
            for (let b of allBtns) console.log(b.innerText, b);
        }

    } catch (e) {
        updateStatus("ERROR: " + e);
        alert("Automation Error: " + e);
    }
}
