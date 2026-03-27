import { initializeApp } from "firebase/app";
import {
    getAuth,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    createUserWithEmailAndPassword
} from "firebase/auth";
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    collection,
    deleteDoc,
    onSnapshot,
    serverTimestamp
} from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// Firebase Initialisation
// PRIMARY app  → admin authentication + all Firestore reads/writes
// SECONDARY app → isolated user-creation so the admin session is NEVER replaced
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyCuUKCxYx0jYKqWOQaN82K5zFGlQsKQsK0",
    authDomain: "ck-manager-1abdc.firebaseapp.com",
    projectId: "ck-manager-1abdc",
    storageBucket: "ck-manager-1abdc.firebasestorage.app",
    messagingSenderId: "890017473158",
    appId: "1:890017473158:web:528e1eebc4b67bd54ca707",
    measurementId: "G-7Z71W1NSX4"
};

const app          = initializeApp(firebaseConfig);
const auth         = getAuth(app);
const db           = getFirestore(app);

// Secondary isolated app — user creation happens here, keeping admin signed in
const secondaryApp  = initializeApp(firebaseConfig, "secondary");
const secondaryAuth = getAuth(secondaryApp);

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let currentAdminUser    = null;
let allUsers            = [];
let isCreatingUser      = false;   // guard: prevents onAuthStateChanged re-entry

// In-memory maps kept in sync by real-time Firestore listeners
let usersMetaMap        = {};      // uid → users_meta document data
let usersPermMap        = {};      // uid → users_permissions document data

// Unsubscribe handles for the real-time listeners
let unsubMeta           = null;
let unsubPerms          = null;

// ─────────────────────────────────────────────────────────────────────────────
// Toast notification
// ─────────────────────────────────────────────────────────────────────────────
function showToast(message, isError = false) {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification ${isError ? 'bg-red-600' : 'bg-green-600'} text-white px-6 py-3 rounded-lg shadow-xl flex items-center`;
    toast.innerHTML = `<i class="fas ${isError ? 'fa-exclamation-triangle' : 'fa-check-circle'} mr-3"></i>${message}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync indicator
// ─────────────────────────────────────────────────────────────────────────────
function showSyncIndicator(show) {
    const indicator = document.getElementById('syncIndicator');
    if (show) {
        indicator.classList.remove('hidden');
    } else {
        indicator.classList.add('hidden');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin check
// ─────────────────────────────────────────────────────────────────────────────
async function isUserAdmin(user) {
    if (!user) return false;
    try {
        const permDoc = await getDoc(doc(db, "users_permissions", user.uid));
        if (permDoc.exists()) {
            return permDoc.data().isAdmin === true;
        }
        return false;
    } catch (err) {
        console.error("isUserAdmin error:", err);
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Escape HTML
// ─────────────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge both maps → build unified user list → render
// Called by BOTH real-time snapshot listeners, so the UI is always current.
// ─────────────────────────────────────────────────────────────────────────────
function mergeAndRender() {
    // Union of all UIDs seen in either collection
    const allUids = new Set([
        ...Object.keys(usersMetaMap),
        ...Object.keys(usersPermMap)
    ]);

    const defaultPerms = { docs: false, finance: false, fleet: false, hr: false, isAdmin: false };

    const users = [];
    for (const uid of allUids) {
        const meta = usersMetaMap[uid] || {};
        const perm = usersPermMap[uid] || { ...defaultPerms };

        // Skip placeholder / pending-sync entries that still need a real UID
        // (they remain in the map so admins can see them, but we mark them)
        users.push({
            uid,
            email:     meta.email || perm.email || `uid-${uid.substring(0, 8)}`,
            pendingSync: meta.needsRealUid === true,
            ...defaultPerms,
            ...perm
        });
    }

    allUsers = users;
    renderUsersTable(users);
    updateStats(users);
}

// ─────────────────────────────────────────────────────────────────────────────
// Real-time Firestore listeners
// Using onSnapshot on BOTH collections avoids the old N+1 getDocs pattern and
// means ANY external change (e.g. user first-login writes to users_meta) appears
// in the panel automatically without a manual refresh.
// ─────────────────────────────────────────────────────────────────────────────
function setupRealtimeListeners() {
    // Tear down any existing listeners first
    if (unsubMeta)  { unsubMeta();  unsubMeta  = null; }
    if (unsubPerms) { unsubPerms(); unsubPerms = null; }

    usersMetaMap = {};
    usersPermMap = {};

    showSyncIndicator(true);

    unsubMeta = onSnapshot(
        collection(db, "users_meta"),
        (snapshot) => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'removed') {
                    delete usersMetaMap[change.doc.id];
                } else {
                    usersMetaMap[change.doc.id] = change.doc.data();
                }
            });
            mergeAndRender();
            showSyncIndicator(false);
        },
        (err) => {
            console.error("users_meta snapshot error:", err);
            showToast("Real-time sync error: " + err.message, true);
            showSyncIndicator(false);
        }
    );

    unsubPerms = onSnapshot(
        collection(db, "users_permissions"),
        (snapshot) => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'removed') {
                    delete usersPermMap[change.doc.id];
                } else {
                    usersPermMap[change.doc.id] = change.doc.data();
                }
            });
            mergeAndRender();
        },
        (err) => {
            console.error("users_permissions snapshot error:", err);
            showToast("Permissions sync error: " + err.message, true);
        }
    );
}

// Stop listeners (called on logout)
function teardownRealtimeListeners() {
    if (unsubMeta)  { unsubMeta();  unsubMeta  = null; }
    if (unsubPerms) { unsubPerms(); unsubPerms = null; }
    usersMetaMap = {};
    usersPermMap = {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy loadAllUsers — kept for manual Refresh button; now just shows indicator
// while onSnapshot delivers results automatically.
// ─────────────────────────────────────────────────────────────────────────────
async function loadAllUsers() {
    showSyncIndicator(true);
    // Listeners are already live; a brief delay then hide indicator
    setTimeout(() => showSyncIndicator(false), 800);
}

// ─────────────────────────────────────────────────────────────────────────────
// Update dashboard stats
// ─────────────────────────────────────────────────────────────────────────────
function updateStats(users) {
    document.getElementById('totalUsers').textContent = users.length;
    let totalPerms = 0, docsCount = 0, fleetCount = 0;
    users.forEach(u => {
        if (u.docs)    { totalPerms++; docsCount++; }
        if (u.finance)   totalPerms++;
        if (u.fleet)   { totalPerms++; fleetCount++; }
        if (u.hr)        totalPerms++;
    });
    document.getElementById('activePermissions').textContent = totalPerms;
    document.getElementById('docsCount').textContent = docsCount;
    document.getElementById('fleetCount').textContent = fleetCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render users table
// ─────────────────────────────────────────────────────────────────────────────
function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if (users.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-8 text-gray-400">
                    <i class="fas fa-user-slash mr-2"></i>
                    No users found. Create a user below or click "Sync All Users".
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = users.map(user => `
        <tr class="border-b border-gray-700 hover:bg-gray-800/30 transition" data-uid="${user.uid}">
            <td class="px-6 py-4">
                <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
                        <i class="fas fa-user text-sm text-gray-400"></i>
                    </div>
                    ${user.pendingSync
                        ? `<span class="text-xs text-yellow-400 permission-badge px-2 py-0.5 rounded-full">
                               <i class="fas fa-clock mr-1"></i>Pending
                           </span>`
                        : ''}
                </div>
            </td>
            <td class="px-6 py-4 text-gray-300 text-sm">${escapeHtml(user.email)}</td>
            <td class="px-6 py-4 text-center">
                <label class="inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="perm-checkbox w-5 h-5 rounded border-gray-600 bg-gray-700 text-green-600 focus:ring-green-500"
                        data-uid="${user.uid}" data-perm="docs" ${user.docs ? 'checked' : ''}>
                </label>
            </td>
            <td class="px-6 py-4 text-center">
                <label class="inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="perm-checkbox w-5 h-5 rounded border-gray-600 bg-gray-700 text-green-600 focus:ring-green-500"
                        data-uid="${user.uid}" data-perm="finance" ${user.finance ? 'checked' : ''}>
                </label>
            </td>
            <td class="px-6 py-4 text-center">
                <label class="inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="perm-checkbox w-5 h-5 rounded border-gray-600 bg-gray-700 text-green-600 focus:ring-green-500"
                        data-uid="${user.uid}" data-perm="fleet" ${user.fleet ? 'checked' : ''}>
                </label>
            </td>
            <td class="px-6 py-4 text-center">
                <label class="inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="perm-checkbox w-5 h-5 rounded border-gray-600 bg-gray-700 text-green-600 focus:ring-green-500"
                        data-uid="${user.uid}" data-perm="hr" ${user.hr ? 'checked' : ''}>
                </label>
            </td>
            <td class="px-6 py-4 text-center">
                <label class="inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="admin-checkbox w-5 h-5 rounded border-gray-600 bg-gray-700 text-yellow-600 focus:ring-yellow-500"
                        data-uid="${user.uid}" ${user.isAdmin ? 'checked' : ''}>
                </label>
            </td>
            <td class="px-6 py-4 text-center">
                <div class="flex items-center justify-center gap-2">
                    <button class="save-user-btn bg-green-700 hover:bg-green-600 px-4 py-1.5 rounded-lg text-sm transition text-white"
                        data-uid="${user.uid}">
                        <i class="fas fa-save mr-1"></i>Save
                    </button>
                    <button class="delete-user-btn bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg text-sm transition text-white"
                        data-uid="${user.uid}" data-email="${escapeHtml(user.email)}">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    // Save buttons
    document.querySelectorAll('.save-user-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const uid = btn.getAttribute('data-uid');
            await saveUserPermissions(uid);
        });
    });

    // Delete buttons
    document.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const uid   = btn.getAttribute('data-uid');
            const email = btn.getAttribute('data-email');
            await deleteUser(uid, email);
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Save permissions for one user
// ─────────────────────────────────────────────────────────────────────────────
async function saveUserPermissions(uid) {
    const btn = document.querySelector(`.save-user-btn[data-uid="${uid}"]`);
    if (!btn) return;

    // Optimistic UI — disable button while saving
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Saving…';

    try {
        const row            = btn.closest('tr');
        const permCheckboxes = row.querySelectorAll('.perm-checkbox');
        const adminCheckbox  = row.querySelector('.admin-checkbox');

        const permissions = {
            docs:    false,
            finance: false,
            fleet:   false,
            hr:      false,
            isAdmin: adminCheckbox ? adminCheckbox.checked : false,
            updatedAt: serverTimestamp(),
            updatedBy: currentAdminUser?.uid || 'admin'
        };

        permCheckboxes.forEach(cb => {
            const perm = cb.getAttribute('data-perm');
            if (perm) permissions[perm] = cb.checked;
        });

        // Use setDoc with merge so doc is created if missing (handles edge cases)
        await setDoc(doc(db, "users_permissions", uid), permissions, { merge: true });

        showToast('Permissions updated successfully');

        // Highlight row briefly
        const row2 = document.querySelector(`tr[data-uid="${uid}"]`);
        if (row2) row2.classList.add('table-row-highlight');

    } catch (error) {
        console.error("Error saving permissions:", error);
        showToast("Failed to save permissions: " + error.message, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save mr-1"></i>Save';
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete user (Firestore only — Firebase Auth account is kept intact)
// ─────────────────────────────────────────────────────────────────────────────
async function deleteUser(uid, email) {
    if (!confirm(`Remove ${email} from the admin panel?\n\nThis deletes their Firestore records (permissions + metadata). Their Firebase Auth account remains — they simply won't appear here until they log in again.`)) {
        return;
    }
    try {
        await deleteDoc(doc(db, "users_meta", uid));
        await deleteDoc(doc(db, "users_permissions", uid));
        showToast(`${email} removed from the panel`);
        // onSnapshot listeners will auto-update the table
    } catch (error) {
        showToast("Failed to remove user: " + error.message, true);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Add a user that exists only in Firebase Auth (no Firestore docs yet)
// Creates placeholder docs. When the user first logs into the main app and
// that app writes their real UID to users_meta, the panel updates automatically.
// ─────────────────────────────────────────────────────────────────────────────
async function addExistingUserByEmail(email) {
    try {
        const tempId = `pending_${Date.now()}_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
        await setDoc(doc(db, "users_meta", tempId), {
            email:        email,
            createdAt:    serverTimestamp(),
            pendingSync:  true,
            needsRealUid: true
        });
        await setDoc(doc(db, "users_permissions", tempId), {
            email:   email,
            docs:    false,
            finance: false,
            fleet:   false,
            hr:      false,
            isAdmin: false
        });
        showToast(`${email} added as pending. Permissions will link automatically on their first login.`);
        // onSnapshot will update the table
    } catch (error) {
        showToast("Failed to add user: " + error.message, true);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Create a brand-new Firebase Auth user
//
// ROOT CAUSE FIX:
//   createUserWithEmailAndPassword on the PRIMARY auth instance automatically
//   signs out the admin and signs in the new user — triggering onAuthStateChanged,
//   which sees a non-admin and calls signOut(), booting the new user from the
//   main app too.
//
//   Solution: use the SECONDARY app's isolated auth instance.
//   The secondary instance has its own session store and does NOT affect the
//   primary admin session at all.
// ─────────────────────────────────────────────────────────────────────────────
async function createNewUser(email, password) {
    isCreatingUser = true;
    showSyncIndicator(true);

    const createBtn = document.querySelector('#createUserForm button[type="submit"]');
    if (createBtn) {
        createBtn.disabled = true;
        createBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Creating…';
    }

    try {
        // ✅ Create via SECONDARY auth — admin session on PRIMARY is untouched
        const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const newUser    = credential.user;

        // Immediately sign out of the secondary instance — no session pollution
        await signOut(secondaryAuth);

        // Write Firestore docs using the PRIMARY db connection (admin is still authed)
        await setDoc(doc(db, "users_meta", newUser.uid), {
            email:     email,
            uid:       newUser.uid,
            createdAt: serverTimestamp(),
            createdBy: currentAdminUser?.uid || 'admin'
        });

        await setDoc(doc(db, "users_permissions", newUser.uid), {
            email:   email,
            uid:     newUser.uid,
            docs:    false,
            finance: false,
            fleet:   false,
            hr:      false,
            isAdmin: false,
            createdAt: serverTimestamp()
        });

        showToast(`User ${email} created successfully!`);

        // Reset form fields
        document.getElementById('newUserEmail').value    = '';
        document.getElementById('newUserPassword').value = '';

        // onSnapshot listeners will auto-add the new row

    } catch (error) {
        console.error("Error creating user:", error);

        if (error.code === 'auth/email-already-in-use') {
            if (confirm(`${email} already exists in Firebase Auth but may not have Firestore records.\n\nAdd them as a pending user to this panel?`)) {
                await addExistingUserByEmail(email);
            } else {
                showToast("Email already in use", true);
            }
        } else if (error.code === 'auth/weak-password') {
            showToast("Password is too weak — minimum 6 characters", true);
        } else if (error.code === 'auth/invalid-email') {
            showToast("Invalid email address", true);
        } else {
            showToast("Failed to create user: " + error.message, true);
        }
    } finally {
        isCreatingUser = false;
        showSyncIndicator(false);
        if (createBtn) {
            createBtn.disabled = false;
            createBtn.innerHTML = '<i class="fas fa-plus mr-2"></i>Create User';
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync All Users
// With onSnapshot already active, this is mainly a visual confirmation trigger.
// ─────────────────────────────────────────────────────────────────────────────
async function syncAllUsers() {
    showToast("Syncing user list in real-time…");
    showSyncIndicator(true);
    // Re-attach listeners to force a fresh read from server
    setupRealtimeListeners();
}

// ─────────────────────────────────────────────────────────────────────────────
// Show the admin dashboard and start real-time sync
// ─────────────────────────────────────────────────────────────────────────────
function showDashboard(user) {
    currentAdminUser = user;
    document.getElementById('adminEmail').textContent = user.email;
    document.getElementById('loginSection').classList.add('hidden');
    document.getElementById('adminDashboard').classList.remove('hidden');
    setupRealtimeListeners();
}

// ─────────────────────────────────────────────────────────────────────────────
// Hide dashboard and clean up
// ─────────────────────────────────────────────────────────────────────────────
function hideDashboard() {
    currentAdminUser = null;
    teardownRealtimeListeners();
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('adminDashboard').classList.add('hidden');
    document.getElementById('adminEmail').textContent = '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth state observer
//
// Guard: if isCreatingUser is true we are in the middle of a user-creation
// cycle. Because we now use the SECONDARY app, onAuthStateChanged on the
// PRIMARY auth should never fire during creation — but the flag is kept as a
// safety net in case of any edge-case SDK behaviour.
// ─────────────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (isCreatingUser) return; // safety guard — should not be needed with secondary app

    if (user) {
        const adminOk = await isUserAdmin(user);
        if (adminOk) {
            showDashboard(user);
        } else {
            // Not an admin — sign out silently (this path is hit when a
            // non-admin somehow lands on this page, NOT during user creation)
            await signOut(auth);
            hideDashboard();
            showToast("Access denied: no admin privileges", true);
        }
    } else {
        hideDashboard();
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Login form
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('adminEmailInput').value.trim();
    const password = document.getElementById('adminPasswordInput').value;

    const loginBtn = e.target.querySelector('button[type="submit"]');
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Verifying…';

    try {
        showSyncIndicator(true);
        const credential = await signInWithEmailAndPassword(auth, email, password);
        const user       = credential.user;

        const adminOk = await isUserAdmin(user);
        if (!adminOk) {
            await signOut(auth);
            showToast("Access denied: You don't have admin privileges", true);
            showSyncIndicator(false);
            return;
        }

        // onAuthStateChanged will call showDashboard automatically
        showToast("Welcome to the Admin Panel");

    } catch (error) {
        console.error("Login error:", error);
        const msg = {
            'auth/user-not-found':  'No account found with that email',
            'auth/wrong-password':  'Incorrect password',
            'auth/invalid-email':   'Invalid email address',
            'auth/too-many-requests': 'Too many attempts — try again later'
        }[error.code] || error.message;
        showToast("Login failed: " + msg, true);
        showSyncIndicator(false);
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Login as Admin';
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async () => {
    teardownRealtimeListeners();
    await signOut(auth);
    document.getElementById('adminEmailInput').value    = '';
    document.getElementById('adminPasswordInput').value = '';
    showToast("Logged out successfully");
    // hideDashboard() is called by onAuthStateChanged
});

// ─────────────────────────────────────────────────────────────────────────────
// Create user form
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('newUserEmail').value.trim();
    const password = document.getElementById('newUserPassword').value;

    if (!email || !password) {
        showToast("Please fill in both email and password", true);
        return;
    }
    if (password.length < 6) {
        showToast("Password must be at least 6 characters", true);
        return;
    }

    await createNewUser(email, password);
});

// ─────────────────────────────────────────────────────────────────────────────
// Misc button handlers
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('resetFormBtn').addEventListener('click', () => {
    document.getElementById('newUserEmail').value    = '';
    document.getElementById('newUserPassword').value = '';
});

document.getElementById('refreshUsersBtn').addEventListener('click', async () => {
    showSyncIndicator(true);
    showToast("Refreshing…");
    setupRealtimeListeners();
});

document.getElementById('syncAllUsersBtn').addEventListener('click', async () => {
    await syncAllUsers();
});
