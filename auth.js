// =========================================================
// SaveTronik - Système d'authentification et panier
// auth.js — chargé sur toutes les pages après config.js
// =========================================================

// ✅ CLIENT SUPABASE UNIQUE — stocké dans window.db
if (!window.db) {
    window.db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('[SaveTronik Auth] ✅ window.db initialisé depuis auth.js');
} else {
    console.log('[SaveTronik Auth] ♻️ window.db déjà présent, réutilisé');
}

const db = window.db;
let currentUser = null;

// =========================================================
// AUTHENTIFICATION
// =========================================================

async function checkAuth() {
    const session = localStorage.getItem('savetronik_session');
    if (session) {
        try {
            const sessionData = JSON.parse(session);
            const { data, error } = await db.auth.getUser(sessionData.access_token);
            if (!error && data.user) {
                currentUser = data.user;
                console.log('[SaveTronik Auth] ✅ Session valide');
                return currentUser;
            }
        } catch (e) {
            console.log('[SaveTronik Auth] ⚠️ Session expirée ou invalide');
            localStorage.removeItem('savetronik_session');
        }
    }
    return null;
}

async function signUp(email, password) {
    const { data, error } = await db.auth.signUp({ email, password });
    if (error) return { success: false, error: error.message };
    return { success: true, data };
}

async function signIn(email, password) {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) return { success: false, error: error.message };
    localStorage.setItem('savetronik_session', JSON.stringify(data.session));
    currentUser = data.user;
    await syncPanierAfterLogin();
    return { success: true, user: currentUser };
}

async function signOut() {
    await savePanierToSupabase();
    await db.auth.signOut();
    localStorage.removeItem('savetronik_session');
    localStorage.removeItem('savetronik_panier');
    currentUser = null;
    return { success: true };
}

// =========================================================
// RÔLE ADMIN — lu depuis user_metadata (jamais d'email en dur)
// Pour activer : dans Supabase Dashboard > Authentication > Users
// > cliquer sur le compte admin > Edit > user_metadata :
// { "role": "admin" }
// =========================================================

function isAdmin() {
    if (!currentUser) return false;
    return currentUser.user_metadata?.role === 'admin';
}

// =========================================================
// PANIER — synchronisé avec Supabase si connecté
// =========================================================

function getPanier() {
    try {
        return JSON.parse(localStorage.getItem('savetronik_panier') || '[]');
    } catch (e) {
        return [];
    }
}

function _savePanierLocal(panier) {
    localStorage.setItem('savetronik_panier', JSON.stringify(panier));
    updatePanierBadge();
}

function savePanier(panier) {
    _savePanierLocal(panier);
    if (currentUser) {
        savePanierToSupabase().catch(e =>
            console.warn('[SaveTronik Panier] ⚠️ Sync Supabase échoué silencieusement :', e.message)
        );
    }
}

async function savePanierToSupabase() {
    if (!currentUser) return;
    const panier = getPanier();
    // On tente d'abord un update, puis un insert si aucune ligne n'existe
    const { data: existing } = await db
        .from('panier')
        .select('id')
        .eq('user_id', currentUser.id)
        .maybeSingle();

    let error;
    if (existing) {
        ({ error } = await db
            .from('panier')
            .update({ contenu: panier, updated_at: new Date().toISOString() })
            .eq('user_id', currentUser.id));
    } else {
        ({ error } = await db
            .from('panier')
            .insert({ user_id: currentUser.id, contenu: panier }));
    }

    if (error) {
        console.warn('[SaveTronik Panier] ⚠️ Erreur sauvegarde :', error.message);
    } else {
        console.log('[SaveTronik Panier] ✅ Panier sauvegardé en base');
    }
}

async function loadPanierFromSupabase() {
    if (!currentUser) return;
    const { data, error } = await db
        .from('panier')
        .select('contenu')
        .eq('user_id', currentUser.id)
        .maybeSingle();

    if (error) {
        console.warn('[SaveTronik Panier] ⚠️ Erreur chargement :', error.message);
        return;
    }
    if (data && data.contenu) {
        // contenu est un jsonb Supabase → déjà un tableau JS, pas besoin de JSON.parse
        const panierDistant = Array.isArray(data.contenu)
            ? data.contenu
            : JSON.parse(data.contenu);
        _savePanierLocal(panierDistant);
        console.log('[SaveTronik Panier] ✅ Panier chargé :', panierDistant.length, 'article(s)');
    }
}

async function syncPanierAfterLogin() {
    const panierLocal = getPanier();

    const { data, error } = await db
        .from('panier')
        .select('contenu')
        .eq('user_id', currentUser.id)
        .maybeSingle();

    let panierDistant = [];
    if (!error && data && data.contenu) {
        panierDistant = Array.isArray(data.contenu)
            ? data.contenu
            : JSON.parse(data.contenu);
    }

    // Fusion : panier local prime, articles distants absents localement sont ajoutés
    const fusion = [...panierLocal];
    for (const item of panierDistant) {
        if (!fusion.find(p => p.id === item.id)) fusion.push(item);
    }

    _savePanierLocal(fusion);
    await savePanierToSupabase();
    console.log('[SaveTronik Panier] ✅ Panier fusionné :', fusion.length, 'article(s)');
}

function addToPanier(product) {
    const panier = getPanier();
    const idx = panier.findIndex(p => p.id === product.id);
    if (idx > -1) {
        panier[idx].quantite = (panier[idx].quantite || 1) + 1;
    } else {
        panier.push({ id: product.id, nom: product.nom, prix: product.prix, image_url: product.image_url, quantite: 1 });
    }
    savePanier(panier);
    console.log('[SaveTronik Panier] ✅ Ajouté :', product.nom);
    return panier;
}

function removeFromPanier(productId) {
    const panier = getPanier().filter(p => p.id !== productId);
    savePanier(panier);
    return panier;
}

function updateQuantite(productId, quantite) {
    const panier = getPanier();
    const idx = panier.findIndex(p => p.id === productId);
    if (idx > -1) {
        if (quantite <= 0) panier.splice(idx, 1);
        else panier[idx].quantite = quantite;
    }
    savePanier(panier);
    return panier;
}

function clearPanier() {
    savePanier([]);
    console.log('[SaveTronik Panier] ✅ Panier vidé');
}

function getTotalPanier() {
    return getPanier().reduce((t, p) => t + (p.prix * (p.quantite || 1)), 0);
}

function updatePanierBadge() {
    const badge = document.getElementById('panier-badge');
    if (!badge) return;
    const total = getPanier().reduce((t, p) => t + (p.quantite || 1), 0);
    badge.textContent = total;
    badge.style.display = total > 0 ? 'block' : 'none';
}

// =========================================================
// UI — Modal d'authentification
// =========================================================

function showAuthModal(mode = 'signin') {
    closeAuthModal();
    const modal = document.createElement('div');
    modal.id = 'auth-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <button class="modal-close" onclick="closeAuthModal()">&times;</button>
            <h2 id="auth-title">${mode === 'signin' ? 'Connexion' : 'Inscription'}</h2>
            <form id="auth-form">
                <div class="form-group">
                    <label for="auth-email">Email</label>
                    <input type="email" id="auth-email" required placeholder="votre@email.com">
                </div>
                <div class="form-group">
                    <label for="auth-password">Mot de passe</label>
                    <input type="password" id="auth-password" required placeholder="••••••••">
                </div>
                <div id="auth-error" class="error-message" style="display:none;"></div>
                <button type="submit" class="btn-submit" id="auth-submit">
                    ${mode === 'signin' ? 'Se connecter' : "S'inscrire"}
                </button>
            </form>
            <p class="auth-switch">
                ${mode === 'signin'
                    ? "Pas de compte ? <a href=\"#\" onclick=\"showAuthModal('signup')\">S'inscrire</a>"
                    : "Déjà un compte ? <a href=\"#\" onclick=\"showAuthModal('signin')\">Se connecter</a>"
                }
            </p>
        </div>`;
    document.body.appendChild(modal);

    document.getElementById('auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email    = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        const errorDiv = document.getElementById('auth-error');
        const btn      = document.getElementById('auth-submit');
        btn.disabled   = true;
        btn.textContent = 'Chargement...';

        const result = mode === 'signin'
            ? await signIn(email, password)
            : await signUp(email, password);

        if (result.success) {
            closeAuthModal();
            updateAuthUI();
            showNotification(mode === 'signin' ? 'Connecté !' : 'Compte créé !', 'success');
        } else {
            errorDiv.textContent = result.error;
            errorDiv.style.display = 'block';
            btn.disabled = false;
            btn.textContent = mode === 'signin' ? 'Se connecter' : "S'inscrire";
        }
    });
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.remove();
}

function updateAuthUI() {
    const authLink = document.getElementById('auth-link');
    if (currentUser) {
        if (authLink) {
            authLink.href = 'compte.html';
            authLink.innerHTML = '👤 Mon compte';
            authLink.onclick = null;
        }
    } else {
        if (authLink) {
            authLink.href = '#';
            authLink.innerHTML = '🔑 Connexion';
            authLink.onclick = (e) => { e.preventDefault(); showAuthModal('signin'); };
        }
    }
    updatePanierBadge();
    updateAdminButton();
}

function updateAdminButton() {
    // Retirer l'éventuel bouton déjà présent
    const existing = document.getElementById('admin-nav-link');
    if (existing) existing.closest('li').remove();

    if (isAdmin()) {
        const navUl = document.querySelector('nav ul');
        if (!navUl) return;
        const li = document.createElement('li');
        li.innerHTML = '<a href="admin.html" id="admin-nav-link" style="color:var(--accent);font-weight:bold;">⚙️ Admin</a>';
        navUl.appendChild(li);
    }
}

function showNotification(message, type = 'success') {
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

// =========================================================
// STYLES DU MODAL (injectés une seule fois)
// =========================================================
if (!document.getElementById('auth-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'auth-styles';
    styleEl.textContent = `
        .modal-overlay { position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000; }
        .modal-content { background:var(--bg-card);padding:2rem;border-radius:12px;max-width:400px;width:90%;position:relative;border:1px solid var(--primary); }
        .modal-close { position:absolute;top:10px;right:15px;background:none;border:none;color:var(--text);font-size:1.5rem;cursor:pointer; }
        .modal-close:hover { color:var(--primary); }
        #auth-title { color:var(--primary);margin-bottom:1.5rem;text-align:center; }
        .auth-switch { text-align:center;margin-top:1rem;color:var(--text-muted); }
        .auth-switch a { color:var(--secondary); }
        .error-message { background:rgba(255,68,68,0.2);color:#ff4444;padding:0.75rem;border-radius:8px;margin-bottom:1rem; }
        .panier-badge { background:var(--accent);color:white;border-radius:50%;padding:0.2rem 0.5rem;font-size:0.75rem;margin-left:0.5rem; }
        .notification { position:fixed;top:100px;right:20px;padding:1rem 2rem;border-radius:8px;z-index:1000;animation:slideIn 0.3s; }
        .notification.success { background:var(--primary);color:var(--bg-dark); }
        .notification.error { background:#ff4444;color:white; }
        @keyframes slideIn { from{transform:translateX(100%)}to{transform:translateX(0)} }
    `;
    document.head.appendChild(styleEl);
}

// =========================================================
// INITIALISATION
// =========================================================
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    updateAuthUI();
    if (currentUser) await loadPanierFromSupabase();
    initHamburger();
});

// =========================================================
// MENU HAMBURGER MOBILE
// =========================================================
function initHamburger() {
    const nav = document.querySelector('header nav');
    const navContainer = document.querySelector('.nav-container');
    if (!nav || !navContainer) return;

    // Créer le bouton hamburger s'il n'existe pas déjà
    if (document.querySelector('.hamburger')) return;

    const btn = document.createElement('button');
    btn.className = 'hamburger';
    btn.setAttribute('aria-label', 'Menu');
    btn.innerHTML = '<span></span><span></span><span></span>';
    navContainer.appendChild(btn);

    // Toggle menu
    btn.addEventListener('click', () => {
        const isOpen = nav.classList.toggle('open');
        btn.classList.toggle('open', isOpen);
        document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    // Fermer en cliquant sur un lien
    nav.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            nav.classList.remove('open');
            btn.classList.remove('open');
            document.body.style.overflow = '';
        });
    });

    // Fermer en cliquant en dehors
    document.addEventListener('click', (e) => {
        if (!nav.contains(e.target) && !btn.contains(e.target)) {
            nav.classList.remove('open');
            btn.classList.remove('open');
            document.body.style.overflow = '';
        }
    });
}

console.log('[SaveTronik Auth] ✅ Module chargé');
