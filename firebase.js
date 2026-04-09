// Firebase configuratie voor SanityDash
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, onSnapshot, addDoc, updateDoc, deleteDoc, query, orderBy, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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

// ==================
// MAIL QUEUE FUNCTIES
// ==================

const MAILS_COLLECTION = 'mails';

// Haal alle mails op (eenmalig)
export async function getMailsFromCloud() {
    try {
        const q = query(collection(db, MAILS_COLLECTION), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        console.error('Error fetching mails:', error);
        return [];
    }
}

// Luister realtime naar mail-queue
export function subscribeToMails(callback) {
    const q = query(collection(db, MAILS_COLLECTION), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
        const mails = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(mails);
    }, (error) => {
        console.error('Error listening to mails:', error);
    });
}

// Voeg nieuwe mail toe aan queue
export async function addMailToCloud(mail) {
    try {
        const now = new Date().toISOString();
        const docRef = await addDoc(collection(db, MAILS_COLLECTION), {
            transcript: mail.transcript || '',
            subject: null,
            body: null,
            status: 'pending',
            mode: mail.mode || 'local',
            workerLease: null,
            attempts: 0,
            error: null,
            createdAt: now,
            updatedAt: now
        });
        return docRef.id;
    } catch (error) {
        console.error('Error adding mail:', error);
        return null;
    }
}

// Update een mail
export async function updateMailInCloud(mailId, updates) {
    try {
        const docRef = doc(db, MAILS_COLLECTION, mailId);
        await updateDoc(docRef, {
            ...updates,
            updatedAt: new Date().toISOString()
        });
        return true;
    } catch (error) {
        console.error('Error updating mail:', error);
        return false;
    }
}

// Verwijder een mail
export async function deleteMailFromCloud(mailId) {
    try {
        await deleteDoc(doc(db, MAILS_COLLECTION, mailId));
        return true;
    } catch (error) {
        console.error('Error deleting mail:', error);
        return false;
    }
}

// Atomic claim van een pending mail voor een worker
// Retourneert de geclaimde mail (met id), of null als niks te doen
export async function claimPendingMail(mailId, workerId, leaseDurationMs = 5 * 60 * 1000) {
    try {
        const docRef = doc(db, MAILS_COLLECTION, mailId);
        const result = await runTransaction(db, async (transaction) => {
            const snap = await transaction.get(docRef);
            if (!snap.exists()) return null;
            const data = snap.data();

            // Niet pending meer? sla over
            if (data.status !== 'pending') return null;

            // Lease nog actief door andere worker?
            if (data.workerLease && data.workerLease.workerId !== workerId) {
                const until = new Date(data.workerLease.until).getTime();
                if (until > Date.now()) return null;
            }

            const now = Date.now();
            const leaseUntil = new Date(now + leaseDurationMs).toISOString();

            transaction.update(docRef, {
                status: 'processing',
                workerLease: { workerId, until: leaseUntil },
                updatedAt: new Date(now).toISOString()
            });

            return { id: snap.id, ...data };
        });
        return result;
    } catch (error) {
        console.error('Error claiming mail:', error);
        return null;
    }
}

// Export db voor directe toegang indien nodig
export { db };
