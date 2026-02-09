import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyCaqrEmvJ-3EZ8Tnt4HLFd2gMb-j5rhkA4",
    authDomain: "sanitydash-aff6a.firebaseapp.com",
    projectId: "sanitydash-aff6a",
    storageBucket: "sanitydash-aff6a.firebasestorage.app",
    messagingSenderId: "1096864734708",
    appId: "1:1096864734708:web:6c39d6b6dfb6837da72da1"
};

// Initialiseer Firebase alleen als er nog geen app is
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

// ===================
// SLIMME TASK PARSER
// ===================
function parseTaskInput(text, contacten) {
    const input = text.trim();

    // Detecteer actie-keywords (langste eerst zodat "mailen" voor "mail" matcht)
    const keywordGroups = [
        { keywords: ['e-mailen', 'emailen', 'mailen', 'e-mail', 'mail'], action: 'mailen' },
        { keywords: ['opbellen', 'bellen', 'bel'], action: 'bellen' },
        { keywords: ['inplannen', 'plannen', 'plan'], action: 'planning' }
    ];

    let actionType = null;
    let matchedKeyword = null;

    for (const group of keywordGroups) {
        for (const kw of group.keywords) {
            const regex = new RegExp('(^|\\s|,)' + kw + '(\\s|,|\\.|!|$)', 'i');
            if (regex.test(input)) {
                actionType = group.action;
                matchedKeyword = kw;
                break;
            }
        }
        if (actionType) break;
    }

    // Detecteer contactnaam (case-insensitive)
    let matchedContact = null;
    for (const contact of contacten) {
        const escaped = contact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp('(^|\\s|,)' + escaped + '(\\s|,|\\.|!|$)', 'i');
        if (regex.test(input)) {
            matchedContact = contact;
            break;
        }
    }

    // Detecteer uren (bv. "2 uur", "3u", "6 uren")
    let uren = null;
    const urenMatch = input.match(/(\d+)\s*(?:uu?r(?:en)?|u)\b/i);
    if (urenMatch) {
        const parsedUren = parseInt(urenMatch[1]);
        if ([1, 2, 3, 6].includes(parsedUren)) {
            uren = parsedUren;
        }
    }

    // Bouw de taakbeschrijving: verwijder het keyword en de contactnaam uit de tekst
    let beschrijving = input;

    // Verwijder het actie-keyword (hele woord)
    if (matchedKeyword) {
        const keywordRegex = new RegExp('(^|\\s|,)' + matchedKeyword + '(\\s|,|\\.|!|$)', 'gi');
        beschrijving = beschrijving.replace(keywordRegex, '$1');
    }

    // Verwijder de contactnaam (hele woord)
    if (matchedContact) {
        const escaped = matchedContact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const contactRegex = new RegExp('(^|\\s|,)' + escaped + '(\\s|,|\\.|!|$)', 'gi');
        beschrijving = beschrijving.replace(contactRegex, '$1');
    }

    // Verwijder uren-patroon
    if (uren) {
        beschrijving = beschrijving.replace(/\d+\s*(?:uu?r(?:en)?|u)\b/i, ' ');
    }

    // Verwijder verbindingswoorden aan het begin
    beschrijving = beschrijving.replace(/^\s*(om\s+te|om|voor|naar|aan|met)\s+/i, '');

    // Trim en verwijder dubbele spaties, komma's aan begin/eind
    beschrijving = beschrijving.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').trim();

    // Maak eerste letter hoofdletter
    if (beschrijving.length > 0) {
        beschrijving = beschrijving.charAt(0).toUpperCase() + beschrijving.slice(1);
    }

    // === ROUTERING ===

    // Mailen/bellen
    if (actionType === 'mailen' || actionType === 'bellen') {
        return {
            category: actionType,
            task: {
                naam: matchedContact || '...',
                taak: beschrijving || 'Taak',
                completed: false
            },
            label: actionType === 'mailen' ? 'Mailen' : 'Bellen'
        };
    }

    // Contact zonder actie-keyword → standaard mailen
    if (matchedContact && !actionType) {
        return {
            category: 'mailen',
            task: {
                naam: matchedContact,
                taak: beschrijving || 'Taak',
                completed: false
            },
            label: 'Mailen'
        };
    }

    // Planning
    if (actionType === 'planning' || uren) {
        return {
            category: 'planning',
            task: {
                titel: beschrijving || input,
                uren: uren,
                completed: false
            },
            label: 'Planning' + (uren ? ` (${uren}u)` : '')
        };
    }

    // Fallback: inbox
    return {
        category: 'inbox',
        task: {
            titel: input,
            completed: false
        },
        label: 'Inbox'
    };
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Auth check - require API key or valid token
    const apiKey = process.env.API_KEY;
    const appPassword = process.env.APP_PASSWORD;
    const providedKey = req.query.key || req.headers['x-api-key'];
    const providedToken = req.headers.authorization?.replace('Bearer ', '');

    const expectedToken = appPassword ? Buffer.from(appPassword + '_sanitydash_auth').toString('base64') : null;

    if (providedKey !== apiKey && providedToken !== expectedToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Support both GET (Alfred) and POST
    let taskText;

    if (req.method === 'GET') {
        taskText = req.query.task || req.query.t;
    } else if (req.method === 'POST') {
        taskText = req.body.task || req.body.t;
    } else {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!taskText) {
        return res.status(400).json({ error: 'Task is required. Use ?task=Your+task+here' });
    }

    try {
        // Laad contacten uit Firebase
        let contacten = [];
        try {
            const contactsRef = doc(db, 'settings', 'contacts');
            const contactsSnap = await getDoc(contactsRef);
            if (contactsSnap.exists()) {
                contacten = contactsSnap.data().contacten || [];
            }
        } catch (e) {
            console.error('Error loading contacts:', e);
        }

        // Parse de input met slimme routing
        const parsed = parseTaskInput(taskText, contacten);

        // Haal huidige taken op
        const docRef = doc(db, 'tasks', 'main');
        const docSnap = await getDoc(docRef);

        let tasks = {
            inbox: [],
            planning: [],
            bellen: [],
            mailen: []
        };

        if (docSnap.exists()) {
            const data = docSnap.data();
            tasks.inbox = data.inbox || [];
            tasks.planning = data.planning || [];
            tasks.bellen = data.bellen || [];
            tasks.mailen = data.mailen || [];
        }

        // Voeg de geparsede taak toe aan de juiste categorie
        if (!tasks[parsed.category]) tasks[parsed.category] = [];
        tasks[parsed.category].push(parsed.task);

        // Sla op
        await setDoc(docRef, {
            ...tasks,
            updatedAt: new Date().toISOString()
        });

        return res.status(200).json({
            success: true,
            message: `${parsed.label} +`,
            category: parsed.category,
            task: parsed.task,
            debug: { contactenCount: contacten.length, contacten: contacten.slice(0, 5) }
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: 'Failed to add task', message: error.message });
    }
}
