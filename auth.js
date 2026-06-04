// =========================================================
// SaveTronik - Système d'authentification et panier
// =========================================================

// Initialisation du client Supabase
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Gestion de l'état d'authentification
let currentUser = null;

// =========================================================
// AUTHENTIFICATION
// =========================================================

// Vérifier si un utilisateur est connecté
async function checkAuth() {
    const session = localStorage.getItem('savetronik_session');
    if (session) {
        try {
            const sessionData = JSON.parse(session);
            // Vérifier si la session est encore valide
            const { data, error } = await db.auth.getUser(sessionData.access_token);
            if (!error && data.user) {
                currentUser = data.user;
                console.log('[SaveTronik Auth] ✅ Session valide pour:', currentUser.email);
                return currentUser;
            }
        } catch (e) {
            console.log('[SaveTronik Auth] Session expirée ou invalide');
            localStorage.removeItem('savetronik_session');
        }
    }
    return null;
}

// Inscription
async function signUp(email, password) {
    console.log('[SaveTronik Auth] 📝 Inscription:', email);
    
    const { data, error } = await db.auth.signUp({
        email: email,
        password: password
    });

    if (error) {
        console.error('[SaveTronik Auth] ❌ Erreur inscription:', error.message);
        return { success: false, error: error.message };
    }

    console.log('[SaveTronik Auth] ✅ Inscription réussie:', data);
    return { success: true, data: data };
}

// Connexion
async function signIn(email, password) {
    console.log('[SaveTronik Auth] 🔐 Connexion:', email);
    
    const { data, error } = await db.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        console.error('[SaveTronik Auth] ❌ Erreur connexion:', error.message);
        return { success: false, error: error.message };
    }

    // Sauvegarder la session
    localStorage.setItem('savetronik_session', JSON.stringify(data.session));
    currentUser = data.user;
    
    console.log('[SaveTronik Auth] ✅ Connecté:', currentUser.email);
    return { success: true, user: currentUser };
}

// Déconnexion
async function signOut() {
    console.log('[SaveTronik Auth] 👋 Déconnexion');
    
    await db.auth.signOut();
    localStorage.removeItem('savetronik_session');
    localStorage.removeItem('savetronik_panier');
    currentUser = null;
    
    console.log('[SaveTronik Auth] ✅ Déconnecté');
    return { success: true };
}

// Vérifier si admin
async function isAdmin() {
    if (!currentUser) return false;
    
    // Email admin défini ici (à changer selon ton besoin)
    const ADMIN_EMAIL = 'admin@savetronik.org';
    
    return currentUser.email === ADMIN_EMAIL;
}

// =========================================================
// PANIER
// =========================================================

// Charger le panier depuis localStorage
function getPanier() {
    const panier = localStorage.getItem('savetronik_panier');
    return panier ? JSON.parse(panier) : [];
}

// Sauvegarder le panier
function savePanier(panier) {
    localStorage.setItem('savetronik_panier', JSON.stringify(panier));
}

// Ajouter au panier
function addToPanier(product) {
    const panier = getPanier();
    
    // Vérifier si le produit est déjà dans le panier
    const existingIndex = panier.findIndex(p => p.id === product.id);
    
    if (existingIndex > -1) {
        // Incrementer la quantité
        panier[existingIndex].quantite = (panier[existingIndex].quantite || 1) + 1;
    } else {
        // Ajouter le produit
        panier.push({
            id: product.id,
            nom: product.nom,
            prix: product.prix,
            image_url: product.image_url,
            quantite: 1
        });
    }
    
    savePanier(panier);
    console.log('[SaveTronik Panier] ✅ Produit ajouté:', product.nom);
    updatePanierBadge();
    return panier;
}

// Retirer du panier
function removeFromPanier(productId) {
    let panier = getPanier();
    panier = panier.filter(p => p.id !== productId);
    savePanier(panier);
    console.log('[SaveTronik Panier] ✅ Produit retiré:', productId);
    updatePanierBadge();
    return panier;
}

// Modifier la quantité
function updateQuantite(productId, quantite) {
    const panier = getPanier();
    const index = panier.findIndex(p => p.id === productId);
    
    if (index > -1) {
        if (quantite <= 0) {
            panier.splice(index, 1);
        } else {
            panier[index].quantite = quantite;
        }
    }
    
    savePanier(panier);
    updatePanierBadge();
    return panier;
}

// Vider le panier
function clearPanier() {
    savePanier([]);
    updatePanierBadge();
    console.log('[SaveTronik Panier] ✅ Panier vidé');
}

// Calculer le total
function getTotalPanier() {
    const panier = getPanier();
    return panier.reduce((total, p) => total + (p.prix * (p.quantite || 1)), 0);
}

// Mettre à jour le badge du panier
function updatePanierBadge() {
    const badge = document.getElementById('panier-badge');
    const panier = getPanier();
    const total = panier.reduce((t, p) => t + (p.quantite || 1), 0);
    
    if (badge) {
        badge.textContent = total;
        badge.style.display = total > 0 ? 'block' : 'none';
    }
}

// =========================================================
// UI - Modal d'authentification
// =========================================================

function showAuthModal(mode = 'signin') {
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
                    ${mode === 'signin' ? 'Se connecter' : 'S\'inscrire'}
                </button>
            </form>
            
            <p class="auth-switch">
                ${mode === 'signin' 
                    ? 'Pas de compte ? <a href="#" onclick="showAuthModal(\'signup\')">S\'inscrire</a>'
                    : 'Déjà un compte ? <a href="#" onclick="showAuthModal(\'signin\')">Se connecter</a>'
                }
            </p>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Gestion du formulaire
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        const errorDiv = document.getElementById('auth-error');
        const submitBtn = document.getElementById('auth-submit');
        
        submitBtn.disabled = true;
        submitBtn.textContent = 'Chargement...';
        
        let result;
        if (mode === 'signin') {
            result = await signIn(email, password);
        } else {
            result = await signUp(email, password);
        }
        
        if (result.success) {
            closeAuthModal();
            updateAuthUI();
            showNotification(mode === 'signin' ? 'Connecté !' : 'Compte créé !', 'success');
        } else {
            errorDiv.textContent = result.error;
            errorDiv.style.display = 'block';
        }
        
        submitBtn.disabled = false;
        submitBtn.textContent = mode === 'signin' ? 'Se connecter' : 'S\'inscrire';
    });
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.remove();
}

// Mettre à jour l'UI selon l'état d'authentification
function updateAuthUI() {
    const authLink = document.getElementById('auth-link');
    const authLabel = document.getElementById('auth-label');
    
    if (currentUser) {
        if (authLink) {
            authLink.href = 'compte.html';
            authLink.innerHTML = '👤 Mon compte';
        }
    } else {
        if (authLink) {
            authLink.href = '#';
            authLink.onclick = (e) => { e.preventDefault(); showAuthModal('signin'); };
            authLink.innerHTML = '🔑 Connexion';
        }
    }
    
    updatePanierBadge();
}

// Notification
function showNotification(message, type = 'success') {
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

// =========================================================
// INITIALISATION
// =========================================================

// Ajouter les styles du modal
const authStyles = `
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}
.modal-content {
    background: var(--bg-card);
    padding: 2rem;
    border-radius: 12px;
    max-width: 400px;
    width: 90%;
    position: relative;
    border: 1px solid var(--primary);
}
.modal-close {
    position: absolute;
    top: 10px;
    right: 15px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 1.5rem;
    cursor: pointer;
}
.modal-close:hover {
    color: var(--primary);
}
#auth-title {
    color: var(--primary);
    margin-bottom: 1.5rem;
    text-align: center;
}
.auth-switch {
    text-align: center;
    margin-top: 1rem;
    color: var(--text-muted);
}
.auth-switch a {
    color: var(--secondary);
}
.error-message {
    background: rgba(255,68,68,0.2);
    color: #ff4444;
    padding: 0.75rem;
    border-radius: 8px;
    margin-bottom: 1rem;
}
.panier-badge {
    background: var(--accent);
    color: white;
    border-radius: 50%;
    padding: 0.2rem 0.5rem;
    font-size: 0.75rem;
    margin-left: 0.5rem;
}
`;

const styleEl = document.createElement('style');
styleEl.textContent = authStyles;
document.head.appendChild(styleEl);

// Initialiser à la fin du chargement
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[SaveTronik] 🚀 Initialisation auth.js');
    await checkAuth();
    updateAuthUI();
});

console.log('[SaveTronik Auth] ✅ Module chargé');