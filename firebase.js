// Firebase configuratie voor SanityDash
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCaqrEmvJ-3EZ8Tnt4HLFd2gMb-j5rhkA4",
    authDomain: "sanitydash-aff6a.firebaseapp.com",
    projectId: "sanitydash-aff6a",
    storageBucket: "sanitydash-aff6a.firebasestorage.app",
    messagingSenderId: "1096864734708",
    appId: "1:1096864734708:web:6c39d6b6dfb6837da72da1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Document ID voor alle taken (simpele setup - 1 gebruiker)
const TASKS_DOC_ID = 'main';
const CONTACTS_DOC_ID = 'contacts';

// ==================
// TAKEN FUNCTIES
// ==================

// Haal taken op uit Firestore
export async function getTasksFromCloud() {
    try {
        const docRef = doc(db, 'tasks', TASKS_DOC_ID);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return docSnap.data();
        } else {
            return {
                inbox: [],
                planning: [],
                bellen: [],
                mailen: []
            };
        }
    } catch (error) {
        console.error('Error fetching tasks:', error);
        return null;
    }
}

// Sla taken op in Firestore
export async function saveTasksToCloud(tasks) {
    try {
        const docRef = doc(db, 'tasks', TASKS_DOC_ID);
        await setDoc(docRef, {
            inbox: tasks.inbox || [],
            planning: tasks.planning || [],
            bellen: tasks.bellen || [],
            mailen: tasks.mailen || [],
            updatedAt: new Date().toISOString()
        });
        return true;
    } catch (error) {
        console.error('Error saving tasks:', error);
        return false;
    }
}

// Voeg een enkele taak toe
export async function addTaskToCloud(category, task) {
    try {
        const tasks = await getTasksFromCloud();
        if (!tasks) return false;

        if (!tasks[category]) {
            tasks[category] = [];
        }

        tasks[category].push(task);
        return await saveTasksToCloud(tasks);
    } catch (error) {
        console.error('Error adding task:', error);
        return false;
    }
}

// Luister naar veranderingen in real-time
export function subscribeToTasks(callback) {
    const docRef = doc(db, 'tasks', TASKS_DOC_ID);
    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            callback(docSnap.data());
        } else {
            callback({
                inbox: [],
                planning: [],
                bellen: [],
                mailen: []
            });
        }
    }, (error) => {
        console.error('Error listening to tasks:', error);
    });
}

// ==================
// CONTACTEN FUNCTIES
// ==================

export async function getContactsFromCloud() {
    try {
        const docRef = doc(db, 'settings', CONTACTS_DOC_ID);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return docSnap.data().contacten || [];
        }
        return [];
    } catch (error) {
        console.error('Error fetching contacts:', error);
        return [];
    }
}

export async function saveContactsToCloud(contacten) {
    try {
        const docRef = doc(db, 'settings', CONTACTS_DOC_ID);
        await setDoc(docRef, {
            contacten: contacten,
            updatedAt: new Date().toISOString()
        });
        return true;
    } catch (error) {
        console.error('Error saving contacts:', error);
        return false;
    }
}

// Export db voor directe toegang indien nodig
export { db };
