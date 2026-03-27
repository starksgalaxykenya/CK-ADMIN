// Import Firebase modules (make sure these are installed or loaded via CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged, 
    createUserWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
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
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Firebase Configuration - VERIFY THIS API KEY IS CORRECT
const firebaseConfig = {
    apiKey: "AIzaSyCuUKCxYx0jYKqWOQaN82K5zFGlQsKQsK0",
    authDomain: "ck-manager-1abdc.firebaseapp.com",
    projectId: "ck-manager-1abdc",
    storageBucket: "ck-manager-1abdc.firebasestorage.app",
    messagingSenderId: "890017473158",
    appId: "1:890017473158:web:528e1eebc4b67bd54ca707",
    measurementId: "G-7Z71W1NSX4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Secondary isolated app for user creation
const secondaryApp = initializeApp(firebaseConfig, "secondary");
const secondaryAuth = getAuth(secondaryApp);

// State variables
let currentAdminUser = null;
let allUsers = [];
let isCreatingUser = false;
let usersMetaMap = {};
let usersPermMap = {};
let unsubMeta = null;
let unsubPerms = null;

// Toast notification function
function showToast(message, isError = false) {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification ${isError ? 'bg-red-600' : 'bg-green-600'} text-white px-6 py-3 rounded-lg shadow-xl flex items-center`;
    toast.innerHTML = `<i class="fas ${isError ? 'fa-exclamation-triangle' : 'fa-check-circle'} mr-3"></i>${message}`;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.zIndex = '9999';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function showSyncIndicator(show) {
    const indicator = document.getElementById('syncIndicator');
    if (indicator) {
        if (show) {
            indicator.classList.remove('hidden');
        } else {
            indicator.classList.add('hidden');
        }
    }
}

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

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}

function mergeAndRender() {
    const allUids = new Set([
        ...Object.keys(usersMetaMap),
        ...Object.keys(usersPermMap)
    ]);

    const defaultPerms = { docs: false, finance: false, fleet: false, hr: false, isAdmin: false };

    const users = [];
    for (const uid of allUids) {
        const meta = usersMetaMap[uid] || {};
        const perm = usersPermMap[uid] || { ...defaultPerms };

        users.push({
            uid,
            email: meta.email || perm.email || `uid-${uid.substring(0, 8)}`,
            pendingSync: meta.needsRealUid === true,
            ...defaultPerms,
            ...perm
        });
    }

    allUsers = users;
    renderUsersTable(users);
    updateStats(users);
}

function setupRealtimeListeners() {
    if (unsubMeta) { unsubMeta(); unsubMeta = null; }
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

function teardownRealtimeListeners() {
    if (unsubMeta) { unsubMeta(); unsubMeta = null; }
    if (unsubPerms) { unsubPerms(); unsubPerms = null; }
    usersMetaMap = {};
    usersPermMap = {};
}

async function loadAllUsers() {
    showSyncIndicator(true);
    setTimeout(() => showSyncIndicator(false), 800);
}

function updateStats(users) {
    const totalUsersEl = document.getElementById('totalUsers');
    const activePermsEl = document.getElementById('activePermissions');
    const docsCountEl = document.getElementById('docsCount');
    const fleetCountEl = document.getElementById('fleetCount');
    
    if (totalUsersEl) totalUsersEl.textContent = users.length;
    
    let totalPerms = 0, docsCount = 0, fleetCount = 0;
    users.forEach(u => {
        if (u.docs) { totalPerms++; docsCount++; }
        if (u.finance) totalPerms++;
        if (u.fleet) { totalPerms++; fleetCount++; }
        if (u.hr) totalPerms++;
    });
    
    if (activePermsEl) activePermsEl.textContent = totalPerms;
    if (docsCountEl) docsCountEl.textContent = docsCount;
    if (fleetCountEl) fleetCountEl.textContent = fleetCount;
}

function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    
    if (users.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-8 text-gray-400">
                    <i class="fas fa-user-slash mr-2"></i>
                    No users found. Create a user below.
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
                    ${user.pendingSync ? `<span class="text-xs text-yellow-400 px-2 py-0.5 rounded-full"><i class="fas fa-clock mr-1"></i>Pending</span>` : ''}
                </div>
            </td>
            <td class="px-6 py-4 text-gray-300 text-sm">${escapeHtml(user.email)}</td>
            <td class="px-6 py-4 text-center">
                <input type="checkbox" class="perm-checkbox w-5 h-5 rounded border-gray-600 bg-gray-700 text-green-600 focus:ring-green-500"
                    data-uid="${user.uid}" data-perm="docs" ${user.docs ? 'checked' : ''}>
            </td>
            <td class="px-6 py-4 text-center">
                <input type="checkbox" class="perm-checkbox w-5 h-5 rounded border-gray-600 bg-gray-700 text-green-600 focus:ring-green-500"
                    data-uid="${user.uid}" data-perm="finance" ${user.finance ? 'checked' : ''}>
            </td>
            <td class="px-6 py-4 text-center">
                <input type="checkbox" class="perm-checkbox w-5 h-5 rounded border-gray-600 bg-gray-700 text-green-600 focus:ring-green-500"
                    data-uid="${user.uid}" data-perm="fleet" ${user.fleet ? 'checked' : ''}>
            </td>
            <td class="px-6 py-4 text-center">
                <input type="checkbox" class="perm-checkbox w-5 h-5 rounded border-gray-600 bg-gray-700 text-green-600 focus:ring-green-500"
                    data-uid="${user.uid}" data-perm="hr" ${user.hr ? 'checked' : ''}>
            </td>
            <td class="px-6 py-4 text-center">
                <input type="checkbox" class="admin-checkbox w-5 h-5 rounded border-gray-600 bg-gray-700 text-yellow-600 focus:ring-yellow-500"
                    data-uid="${user.uid}" ${user.isAdmin ? 'checked' : ''}>
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

    // Attach event listeners
    document.querySelectorAll('.save-user-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const uid = btn.getAttribute('data-uid');
            await saveUserPermissions(uid);
        });
    });

    document.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const uid = btn.getAttribute('data-uid');
            const email = btn.getAttribute('data-email');
            await deleteUser(uid, email);
        });
    });
}

async function saveUserPermissions(uid) {
    const btn = document.querySelector(`.save-user-btn[data-uid="${uid}"]`);
    if (!btn) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Saving…';

    try {
        const row = btn.closest('tr');
        const permCheckboxes = row.querySelectorAll('.perm-checkbox');
        const adminCheckbox = row.querySelector('.admin-checkbox');

        const permissions = {
            docs: false,
            finance: false,
            fleet: false,
            hr: false,
            isAdmin: adminCheckbox ? adminCheckbox.checked : false,
            updatedAt: serverTimestamp(),
            updatedBy: currentAdminUser?.uid || 'admin'
        };

        permCheckboxes.forEach(cb => {
            const perm = cb.getAttribute('data-perm');
            if (perm) permissions[perm] = cb.checked;
        });

        await setDoc(doc(db, "users_permissions", uid), permissions, { merge: true });
        showToast('Permissions updated successfully');
    } catch (error) {
        console.error("Error saving permissions:", error);
        showToast("Failed to save permissions: " + error.message, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save mr-1"></i>Save';
    }
}

async function deleteUser(uid, email) {
    if (!confirm(`Remove ${email} from the admin panel?\n\nThis deletes their Firestore records. Their Firebase Auth account remains.`)) {
        return;
    }
    try {
        await deleteDoc(doc(db, "users_meta", uid));
        await deleteDoc(doc(db, "users_permissions", uid));
        showToast(`${email} removed from the panel`);
    } catch (error) {
        showToast("Failed to remove user: " + error.message, true);
    }
}

async function addExistingUserByEmail(email) {
    try {
        const tempId = `pending_${Date.now()}_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
        await setDoc(doc(db, "users_meta", tempId), {
            email: email,
            createdAt: serverTimestamp(),
            pendingSync: true,
            needsRealUid: true
        });
        await setDoc(doc(db, "users_permissions", tempId), {
            email: email,
            docs: false,
            finance: false,
            fleet: false,
            hr: false,
            isAdmin: false
        });
        showToast(`${email} added as pending.`);
    } catch (error) {
        showToast("Failed to add user: " + error.message, true);
    }
}

async function createNewUser(email, password) {
    isCreatingUser = true;
    showSyncIndicator(true);

    const createBtn = document.querySelector('#createUserForm button[type="submit"]');
    if (createBtn) {
        createBtn.disabled = true;
        createBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Creating…';
    }

    try {
        const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const newUser = credential.user;
        await signOut(secondaryAuth);

        await setDoc(doc(db, "users_meta", newUser.uid), {
            email: email,
            uid: newUser.uid,
            createdAt: serverTimestamp(),
            createdBy: currentAdminUser?.uid || 'admin'
        });

        await setDoc(doc(db, "users_permissions", newUser.uid), {
            email: email,
            uid: newUser.uid,
            docs: false,
            finance: false,
            fleet: false,
            hr: false,
            isAdmin: false,
            createdAt: serverTimestamp()
        });

        showToast(`User ${email} created successfully!`);
        document.getElementById('newUserEmail').value = '';
        document.getElementById('newUserPassword').value = '';

    } catch (error) {
        console.error("Error creating user:", error);

        if (error.code === 'auth/email-already-in-use') {
            if (confirm(`${email} already exists. Add them as pending?`)) {
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

async function syncAllUsers() {
    showToast("Syncing user list in real-time…");
    showSyncIndicator(true);
    setupRealtimeListeners();
}

function showDashboard(user) {
    currentAdminUser = user;
    const adminEmailEl = document.getElementById('adminEmail');
    const loginSection = document.getElementById('loginSection');
    const adminDashboard = document.getElementById('adminDashboard');
    
    if (adminEmailEl) adminEmailEl.textContent = user.email;
    if (loginSection) loginSection.classList.add('hidden');
    if (adminDashboard) adminDashboard.classList.remove('hidden');
    setupRealtimeListeners();
}

function hideDashboard() {
    currentAdminUser = null;
    teardownRealtimeListeners();
    const loginSection = document.getElementById('loginSection');
    const adminDashboard = document.getElementById('adminDashboard');
    const adminEmailEl = document.getElementById('adminEmail');
    
    if (loginSection) loginSection.classList.remove('hidden');
    if (adminDashboard) adminDashboard.classList.add('hidden');
    if (adminEmailEl) adminEmailEl.textContent = '';
}

// Auth state observer
onAuthStateChanged(auth, async (user) => {
    if (isCreatingUser) return;

    if (user) {
        const adminOk = await isUserAdmin(user);
        if (adminOk) {
            showDashboard(user);
        } else {
            await signOut(auth);
            hideDashboard();
            showToast("Access denied: no admin privileges", true);
        }
    } else {
        hideDashboard();
    }
});

// Login form handler
const loginForm = document.getElementById('adminLoginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('adminEmailInput').value.trim();
        const password = document.getElementById('adminPasswordInput').value;

        const loginBtn = e.target.querySelector('button[type="submit"]');
        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Verifying…';
        }

        try {
            showSyncIndicator(true);
            const credential = await signInWithEmailAndPassword(auth, email, password);
            const user = credential.user;

            const adminOk = await isUserAdmin(user);
            if (!adminOk) {
                await signOut(auth);
                showToast("Access denied: You don't have admin privileges", true);
                showSyncIndicator(false);
                return;
            }

            showToast("Welcome to the Admin Panel");

        } catch (error) {
            console.error("Login error:", error);
            let errorMessage = "";
            
            switch (error.code) {
                case 'auth/invalid-credential':
                    errorMessage = 'Invalid email or password';
                    break;
                case 'auth/invalid-email':
                    errorMessage = 'Invalid email address format';
                    break;
                case 'auth/user-disabled':
                    errorMessage = 'This account has been disabled';
                    break;
                case 'auth/too-many-requests':
                    errorMessage = 'Too many failed attempts. Please try again later';
                    break;
                case 'auth/network-request-failed':
                    errorMessage = 'Network error. Please check your connection';
                    break;
                default:
                    errorMessage = error.message || 'Login failed';
            }
            
            showToast("Login failed: " + errorMessage, true);
            showSyncIndicator(false);
        } finally {
            if (loginBtn) {
                loginBtn.disabled = false;
                loginBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Login as Admin';
            }
        }
    });
}

// Logout handler
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        teardownRealtimeListeners();
        await signOut(auth);
        const emailInput = document.getElementById('adminEmailInput');
        const passwordInput = document.getElementById('adminPasswordInput');
        if (emailInput) emailInput.value = '';
        if (passwordInput) passwordInput.value = '';
        showToast("Logged out successfully");
    });
}

// Create user form handler
const createUserForm = document.getElementById('createUserForm');
if (createUserForm) {
    createUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('newUserEmail').value.trim();
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
}

// Reset form button
const resetFormBtn = document.getElementById('resetFormBtn');
if (resetFormBtn) {
    resetFormBtn.addEventListener('click', () => {
        const emailInput = document.getElementById('newUserEmail');
        const passwordInput = document.getElementById('newUserPassword');
        if (emailInput) emailInput.value = '';
        if (passwordInput) passwordInput.value = '';
    });
}

// Refresh button
const refreshUsersBtn = document.getElementById('refreshUsersBtn');
if (refreshUsersBtn) {
    refreshUsersBtn.addEventListener('click', async () => {
        showSyncIndicator(true);
        showToast("Refreshing…");
        setupRealtimeListeners();
    });
}

// Sync all users button
const syncAllUsersBtn = document.getElementById('syncAllUsersBtn');
if (syncAllUsersBtn) {
    syncAllUsersBtn.addEventListener('click', async () => {
        await syncAllUsers();
    });
}

console.log('Admin panel loaded successfully');
