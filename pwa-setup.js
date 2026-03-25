// PWA Setup Script
(function() {
    // Create service worker registration
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .then(registration => {
                    console.log('Service Worker registered with scope:', registration.scope);
                    
                    // Check for updates
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                console.log('New update available');
                                showUpdateNotification();
                            }
                        });
                    });
                })
                .catch(error => {
                    console.log('Service Worker registration failed:', error);
                });
        });
    }

    // Show update notification
    function showUpdateNotification() {
        const notification = document.createElement('div');
        notification.className = 'toast-notification bg-blue-600 text-white px-6 py-3 rounded-lg shadow-xl flex items-center';
        notification.innerHTML = `
            <i class="fas fa-sync-alt mr-3"></i>
            New version available! Refresh to update.
            <button id="updateBtn" class="ml-4 bg-white text-blue-600 px-3 py-1 rounded-lg">Update</button>
        `;
        document.body.appendChild(notification);
        
        document.getElementById('updateBtn')?.addEventListener('click', () => {
            window.location.reload();
        });
        
        setTimeout(() => notification.remove(), 10000);
    }

    // Install prompt handling
    let deferredPrompt;
    
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        
        // Show install button if needed
        const installBtn = document.getElementById('installBtn');
        if (installBtn) {
            installBtn.classList.remove('hidden');
            installBtn.addEventListener('click', async () => {
                if (deferredPrompt) {
                    deferredPrompt.prompt();
                    const { outcome } = await deferredPrompt.userChoice;
                    console.log(`User response to install prompt: ${outcome}`);
                    deferredPrompt = null;
                    installBtn.classList.add('hidden');
                }
            });
        }
    });

    window.addEventListener('appinstalled', () => {
        console.log('PWA installed successfully');
        const installBtn = document.getElementById('installBtn');
        if (installBtn) installBtn.classList.add('hidden');
    });

    // Check if running in standalone mode
    if (window.matchMedia('(display-mode: standalone)').matches) {
        console.log('Running as PWA');
    }
})();
