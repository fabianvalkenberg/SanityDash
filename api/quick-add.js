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
    let task, category;

    if (req.method === 'GET') {
        task = req.query.task || req.query.t;
        category = req.query.category || req.query.c || 'inbox';
    } else if (req.method === 'POST') {
        task = req.body.task || req.body.t;
        category = req.body.category || req.body.c || 'inbox';
    } else {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!task) {
        return res.status(400).json({ error: 'Task is required. Use ?task=Your+task+here' });
    }

    // Valideer category
    const validCategories = ['inbox', 'planning', 'bellen', 'mailen'];
    if (!validCategories.includes(category)) {
        category = 'inbox';
    }

    try {
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

        // Voeg nieuwe taak toe
        if (category === 'inbox') {
            tasks.inbox.push({
                titel: task,
                completed: false
            });
        } else if (category === 'planning') {
            tasks.planning.push({
                titel: task,
                uren: null,
                completed: false
            });
        } else {
            // Voor bellen/mailen: check of er een ":" in zit voor naam:taak
            const parts = task.split(':');
            if (parts.length > 1) {
                tasks[category].push({
                    naam: parts[0].trim(),
                    taak: parts.slice(1).join(':').trim(),
                    completed: false
                });
            } else {
                tasks[category].push({
                    naam: task,
                    taak: '',
                    completed: false
                });
            }
        }

        // Sla op
        await setDoc(docRef, {
            ...tasks,
            updatedAt: new Date().toISOString()
        });

        return res.status(200).json({
            success: true,
            message: `Taak toegevoegd aan ${category}`,
            task: task
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: 'Failed to add task', message: error.message });
    }
}
