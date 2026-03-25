import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, collection, deleteDoc } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyCuUKCxYx0jYKqWOQaN82K5zFGlQsKQsK0",
    authDomain: "ck-manager-1abdc.firebaseapp.com",
    projectId: "ck-manager-1abdc",
    storageBucket: "ck-manager-1abdc.firebasestorage.app",
    messagingSenderId: "890017473158",
    appId: "1:890017473158:web:528e1eebc4b67bd54ca707",
    measurementId: "G-7Z71W1NSX4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentAdminUser = null;
let allUsers = [];

// Toast notification
function showToast(message, isError = false) {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `toast-notification ${isError ? 'bg-red-600' : 'bg-green-600'} text-white px-6 py-3 rounded-lg shadow-xl flex items-center`;
    toast.innerHTML = `<i class="fas ${isError ? 'fa-exclamation-triangle' : 'fa-check-circle'} mr-3"></i>${message}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Show/hide sync indicator
function showSyncIndicator(show) {
    const indicator = document.getElementById('syncIndicator');
    if (show) {
        indicator.classList.remove('hidden');
    } else {
        indicator.classList.add('hidden');
    }
}

// Check if user is admin
async function isUserAdmin(user) {
    if (!user) return false;
    const permDoc = await getDoc(doc(db, "users_permissions", user.uid));
    if (permDoc.exists()) {
        return permDoc.data().isAdmin === true;
    }
    return false;
}

// Ensure user exists in users_meta
async function ensureUserInMeta(uid, email) {
    try {
        const metaRef = doc(db, "users_meta", uid);
        const metaDoc = await getDoc(metaRef);
        if (!metaDoc.exists()) {
            await setDoc(metaRef, {
                email: email,
                createdAt: new Date().toISOString(),
                syncedAt: new Date().toISOString()
            });
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error ensuring user in meta:", error);
        return false;
    }
}

// Ensure user has permissions document
async function ensureUserPermissions(uid) {
    try {
        const permRef = doc(db, "users_permissions", uid);
        const permDoc = await getDoc(permRef);
        if (!permDoc.exists()) {
            await setDoc(permRef, {
                docs: false,
                finance: false,
                fleet: false,
                hr: false,
                isAdmin: false
            });
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error ensuring permissions:", error);
        return false;
    }
}

// Load all users from Firestore
async function loadAllUsers() {
    try {
        showSyncIndicator(true);
        const usersMetaSnap = await getDocs(collection(db, "users_meta"));
        const usersList = [];
        
        for (const docSnap of usersMetaSnap.docs) {
            const userData = docSnap.data();
            const uid = docSnap.id;
            const permDoc = await getDoc(doc(db, "users_permissions", uid));
            let permissions = { docs: false, finance: false, fleet: false, hr: false, isAdmin: false };
            if (permDoc.exists()) {
                permissions = permDoc.data();
            }
            usersList.push({
                uid,
                email: userData.email || `user-${uid.substring(0, 8)}`,
                ...permissions
            });
        }
        
        allUsers = usersList;
        renderUsersTable(usersList);
        updateStats(usersList);
        showSyncIndicator(false);
        return usersList;
    } catch (error) {
        console.error("Error loading users:", error);
        showToast("Failed to load users: " + error.message, true);
        showSyncIndicator(false);
        return [];
    }
}

// Add existing user by email
async function addExistingUserByEmail(email) {
    try {
        const tempId = `temp_${Date.now()}_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
        await setDoc(doc(db, "users_meta", tempId), {
            email: email,
            createdAt: new Date().toISOString(),
            pendingSync: true,
            needsRealUid: true
        });
        await setDoc(doc(db, "users_permissions", tempId), {
            docs: false,
            finance: false,
            fleet: false,
            hr: false,
            isAdmin: false
        });
        showToast(`User ${email} added. They will be fully synced upon first login.`);
        await loadAllUsers();
    } catch (error) {
        showToast("Failed to add user: " + error.message, true);
    }
}

// Update statistics
function updateStats(users) {
    document.getElementById('totalUsers').textContent = users.length;
    let totalPerms = 0;
    let docsCount = 0, fleetCount = 0;
    users.forEach(u => {
        if (u.docs) { totalPerms++; docsCount++; }
        if (u.finance) totalPerms++;
        if (u.fleet) { totalPerms++; fleetCount++; }
        if (u.hr) totalPerms++;
    });
    document.getElementById('activePermissions').textContent = totalPerms;
    document.getElementById('docsCount').textContent = docsCount;
    document.getElementById('fleetCount').textContent = fleetCount;
}

// Delete user
async function deleteUser(uid, email) {
    if (!confirm(`Are you sure you want to delete user ${email}? This will remove their permissions and metadata. The Firebase Auth account will remain.`)) {
        return;
    }
    try {
        await deleteDoc(doc(db, "users_meta", uid));
        await deleteDoc(doc(db, "users_permissions", uid));
        showToast(`User ${email} removed from admin panel`);
        await loadAllUsers();
    } catch (error) {
        showToast("Failed to delete user: " + error.message, true);
    }
}

// Escape HTML
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Render users table
function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-400"><i class="fas fa-user-slash mr-2"></i>No users found. Create a user or sync existing ones.</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(user => `
        <tr class="border-b border-gray-700 hover:bg-gray-800/30 transition" data-uid="${user.uid}">
            <td class="px-6 py-4">
                <div class="flex items-center">
                    <div class="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
                        <i class="fas fa-user text-sm text-gray-400"></i>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4 text-gray-300">${escapeHtml(user.email)}</td>
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
                    <button class="save-user-btn bg-green-700 hover:bg-green-600 px-4 py-1.5 rounded-lg text-sm transition" data-uid="${user.uid}">
                        <i class="fas fa-save mr-1"></i>Save
                    </button>
                    <button class="delete-user-btn bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg text-sm transition" data-uid="${user.uid}" data-email="${escapeHtml(user.email)}">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
    
    // Attach event listeners to save buttons
    document.querySelectorAll('.save-user-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const uid = btn.getAttribute('data-uid');
            await saveUserPermissions(uid);
        });
    });
    
    // Attach event listeners to delete buttons
    document.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const uid = btn.getAttribute('data-uid');
            const email = btn.getAttribute('data-email');
            await deleteUser(uid, email);
        });
    });
}

// Save permissions for a specific user
async function saveUserPermissions(uid) {
    try {
        const row = document.querySelector(`.save-user-btn[data-uid="${uid}"]`).closest('tr');
        const permCheckboxes = row.querySelectorAll('.perm-checkbox');
        const adminCheckbox = row.querySelector('.admin-checkbox');
        
        const permissions = {
            docs: false,
            finance: false,
            fleet: false,
            hr: false,
            isAdmin: adminCheckbox ? adminCheckbox.checked : false
        };
        
        permCheckboxes.forEach(cb => {
            const perm = cb.getAttribute('data-perm');
            permissions[perm] = cb.checked;
        });
        
        await updateDoc(doc(db, "users_permissions", uid), permissions);
        showToast(`Permissions updated successfully`);
        
        // Refresh stats only
        const updatedUsers = [...allUsers];
        const userIndex = updatedUsers.findIndex(u => u.uid === uid);
        if (userIndex !== -1) {
            updatedUsers[userIndex] = { ...updatedUsers[userIndex], ...permissions };
            updateStats(updatedUsers);
        }
    } catch (error) {
        console.error("Error saving permissions:", error);
        showToast("Failed to save permissions: " + error.message, true);
    }
}

// Create new user
async function createNewUser(email, password) {
    try {
        showSyncIndicator(true);
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUser = userCredential.user;
        
        // Save to users_meta with real UID
        await setDoc(doc(db, "users_meta", newUser.uid), {
            email: email,
            createdAt: new Date().toISOString(),
            createdBy: currentAdminUser?.uid || 'admin'
        });
        
        // Initialize permissions
        await setDoc(doc(db, "users_permissions", newUser.uid), {
            docs: false,
            finance: false,
            fleet: false,
            hr: false,
            isAdmin: false
        });
        
        showToast(`User ${email} created successfully!`);
        await loadAllUsers();
        
        // Reset form
        document.getElementById('newUserEmail').value = '';
        document.getElementById('newUserPassword').value = '';
        showSyncIndicator(false);
        
    } catch (error) {
        console.error("Error creating user:", error);
        showSyncIndicator(false);
        if (error.code === 'auth/email-already-in-use') {
            if (confirm(`Email ${email} already exists in Firebase Auth. Would you like to add them to the admin panel?`)) {
                await addExistingUserByEmail(email);
            } else {
                showToast("Email already exists in Firebase Auth", true);
            }
        } else {
            showToast("Failed to create user: " + error.message, true);
        }
    }
}

// Sync all users
async function syncAllUsers() {
    showToast("Refreshing user list...");
    await loadAllUsers();
    showToast("User list refreshed successfully");
}

// Login handler
document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('adminEmailInput').value;
    const password = document.getElementById('adminPasswordInput').value;
    
    try {
        showSyncIndicator(true);
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        const isAdminUser = await isUserAdmin(user);
        if (!isAdminUser) {
            await signOut(auth);
            showToast("Access denied: You don't have admin privileges", true);
            showSyncIndicator(false);
            return;
        }
        
        currentAdminUser = user;
        document.getElementById('adminEmail').textContent = user.email;
        document.getElementById('loginSection').classList.add('hidden');
        document.getElementById('adminDashboard').classList.remove('hidden');
        await loadAllUsers();
        showToast("Welcome to Admin Panel");
        showSyncIndicator(false);
        
    } catch (error) {
        console.error("Login error:", error);
        showToast("Login failed: " + error.message, true);
        showSyncIndicator(false);
    }
});

// Logout handler
document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    currentAdminUser = null;
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('adminDashboard').classList.add('hidden');
    document.getElementById('adminEmailInput').value = '';
    document.getElementById('adminPasswordInput').value = '';
    showToast("Logged out successfully");
});

// Create user form
document.getElementById('createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('newUserEmail').value;
    const password = document.getElementById('newUserPassword').value;
    
    if (!email || !password) {
        showToast("Please fill in all fields", true);
        return;
    }
    
    if (password.length < 6) {
        showToast("Password must be at least 6 characters", true);
        return;
    }
    
    await createNewUser(email, password);
});

// Reset form
document.getElementById('resetFormBtn').addEventListener('click', () => {
    document.getElementById('newUserEmail').value = '';
    document.getElementById('newUserPassword').value = '';
});

// Refresh button
document.getElementById('refreshUsersBtn').addEventListener('click', async () => {
    await loadAllUsers();
    showToast("Users list refreshed");
});

// Sync all users button
document.getElementById('syncAllUsersBtn').addEventListener('click', async () => {
    await syncAllUsers();
});

// Check auth state on load
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const isAdminUser = await isUserAdmin(user);
        if (isAdminUser) {
            currentAdminUser = user;
            document.getElementById('adminEmail').textContent = user.email;
            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('adminDashboard').classList.remove('hidden');
            await loadAllUsers();
        } else {
            await signOut(auth);
            document.getElementById('loginSection').classList.remove('hidden');
            document.getElementById('adminDashboard').classList.add('hidden');
        }
    } else {
        document.getElementById('loginSection').classList.remove('hidden');
        document.getElementById('adminDashboard').classList.add('hidden');
    }
});
