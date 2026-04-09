// Mail Worker — verwerkt pending mails in de Firestore queue
// Draait in de browser-tab. Eén tab met een bereikbare LM Studio wordt de worker.
//
// Strategie:
// - Elke 3s poll de queue
// - Per pending mail: afhankelijk van mode → local (LM Studio) of claude (Vercel function)
// - Atomic lease-mechanisme voorkomt dat twee tabs dezelfde mail verwerken
// - LM Studio check gecached voor 10s om spam te voorkomen

import { claimPendingMail, updateMailInCloud } from './firebase.js';

const LM_STUDIO_URL = 'http://localhost:1234';
const POLL_INTERVAL_MS = 3000;
const LM_CACHE_MS = 10000;

let workerId = null;
let isRunning = false;
let pollTimer = null;
let fappiewriterPrompt = null;

let lmStudioCheck = { ok: false, at: 0, modelId: null };

function generateWorkerId() {
    return 'w_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
}

async function loadPrompt() {
    if (fappiewriterPrompt) return fappiewriterPrompt;
    try {
        const response = await fetch('/prompts/fappiewriter-mails.md');
        if (!response.ok) throw new Error('prompt fetch failed');
        fappiewriterPrompt = await response.text();
        return fappiewriterPrompt;
    } catch (error) {
        console.error('[mail-worker] failed to load prompt:', error);
        return null;
    }
}

async function checkLMStudio() {
    const now = Date.now();
    if (now - lmStudioCheck.at < LM_CACHE_MS) {
        return lmStudioCheck;
    }
    try {
        const response = await fetch(`${LM_STUDIO_URL}/v1/models`, {
            method: 'GET',
            signal: AbortSignal.timeout(2000)
        });
        if (!response.ok) throw new Error('not ok');
        const data = await response.json();
        const firstModel = data.data && data.data[0] ? data.data[0].id : null;
        lmStudioCheck = { ok: !!firstModel, at: now, modelId: firstModel };
    } catch (e) {
        lmStudioCheck = { ok: false, at: now, modelId: null };
    }
    return lmStudioCheck;
}

function extractJson(text) {
    // Probeer eerst direct te parsen
    try {
        return JSON.parse(text);
    } catch (e) {
        // Fallback: zoek eerste { ... } blok
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch (e2) {
                return null;
            }
        }
        return null;
    }
}

async function processWithLMStudio(mail, prompt, modelId) {
    const systemPrompt = prompt + '\n\nRetourneer ALLEEN een JSON object met de velden "subject" en "body". Geen extra tekst, geen markdown code fences.';

    const response = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: modelId || 'local-model',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Herschrijf onderstaand transcript naar een nette zakelijke mail:\n\n${mail.transcript}` }
            ],
            temperature: 0.7,
            stream: false
        }),
        signal: AbortSignal.timeout(120000) // 2 min max voor Qwen 35B
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`LM Studio error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const content = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : '';

    const parsed = extractJson(content);
    if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
        throw new Error('Invalid JSON response from LM Studio: ' + content.slice(0, 200));
    }

    return { subject: parsed.subject, body: parsed.body };
}

async function processWithClaude(mail) {
    const token = localStorage.getItem('sanityDashToken');
    if (!token) throw new Error('No auth token');

    const response = await fetch('/api/mail-rewrite', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ transcript: mail.transcript })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Claude API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    if (!data.subject || !data.body) {
        throw new Error('Claude response missing fields');
    }

    return { subject: data.subject, body: data.body };
}

async function processMail(mail) {
    const claimed = await claimPendingMail(mail.id, workerId);
    if (!claimed) {
        // Al door een andere worker opgepakt, of niet meer pending
        return;
    }

    console.log('[mail-worker] processing', mail.id, 'mode:', mail.mode);

    try {
        let result;
        if (mail.mode === 'claude') {
            result = await processWithClaude(mail);
        } else {
            const prompt = await loadPrompt();
            if (!prompt) throw new Error('No prompt loaded');
            result = await processWithLMStudio(mail, prompt, lmStudioCheck.modelId);
        }

        await updateMailInCloud(mail.id, {
            status: 'done',
            subject: result.subject,
            body: result.body,
            workerLease: null,
            error: null
        });
        console.log('[mail-worker] done', mail.id);
    } catch (error) {
        console.error('[mail-worker] failed', mail.id, error);
        const attempts = (mail.attempts || 0) + 1;
        await updateMailInCloud(mail.id, {
            status: attempts >= 3 ? 'failed' : 'pending',
            workerLease: null,
            attempts,
            error: error.message || String(error)
        });
    }
}

// Externe state: de huidige mails lijst (wordt gezet door app.js via setter)
let currentMails = [];

export function updateWorkerMails(mails) {
    currentMails = mails || [];
}

async function pollOnce() {
    if (!currentMails || currentMails.length === 0) return;

    const pendingMails = currentMails.filter(m => m.status === 'pending');
    if (pendingMails.length === 0) return;

    // Check LM Studio status voor 'local' mails
    const lm = await checkLMStudio();

    // Verwerk één tegelijk om LM Studio niet te overbelasten
    for (const mail of pendingMails) {
        if (mail.mode === 'claude') {
            // Claude kan altijd
            await processMail(mail);
        } else if (lm.ok) {
            // Local mode, alleen als LM Studio bereikbaar is
            await processMail(mail);
        }
        // Skip als local en LM Studio down
    }
}

export function initMailWorker() {
    if (isRunning) return;
    isRunning = true;
    workerId = generateWorkerId();
    console.log('[mail-worker] started, workerId:', workerId);

    // Kick off polling loop
    const loop = async () => {
        if (!isRunning) return;
        try {
            await pollOnce();
        } catch (error) {
            console.error('[mail-worker] poll error:', error);
        }
        pollTimer = setTimeout(loop, POLL_INTERVAL_MS);
    };
    loop();
}

export function stopMailWorker() {
    isRunning = false;
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
}

export function getWorkerStatus() {
    return {
        running: isRunning,
        workerId,
        lmStudio: lmStudioCheck
    };
}
