// Mail processing helpers — synchroon aangeroepen vanuit de edit-modal.
// LM Studio eerst, automatisch terugvallen op Claude API als LM Studio offline is.

const LM_STUDIO_URL = 'http://localhost:1234';
const LM_CACHE_MS = 10000;

let fappiewriterPrompt = null;
let lmStudioCheck = { ok: false, at: 0, modelId: null };

async function loadPrompt() {
    if (fappiewriterPrompt) return fappiewriterPrompt;
    try {
        const response = await fetch('/prompts/fappiewriter-mails.md');
        if (!response.ok) throw new Error('prompt fetch failed');
        fappiewriterPrompt = await response.text();
        return fappiewriterPrompt;
    } catch (error) {
        console.error('[mail] failed to load prompt:', error);
        return null;
    }
}

export async function checkLMStudio(force = false) {
    const now = Date.now();
    if (!force && now - lmStudioCheck.at < LM_CACHE_MS) {
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
    try {
        return JSON.parse(text);
    } catch (e) {
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

async function processWithLMStudio(transcript, prompt, modelId) {
    const systemPrompt = prompt + '\n\nRetourneer ALLEEN een JSON object met de velden "subject" en "body". Geen extra tekst, geen markdown code fences.';

    const response = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: modelId || 'local-model',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Herschrijf onderstaand transcript naar een nette zakelijke mail:\n\n${transcript}` }
            ],
            temperature: 0.7,
            stream: false
        }),
        signal: AbortSignal.timeout(120000)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`LM Studio error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : '';

    const parsed = extractJson(content);
    if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
        throw new Error('Ongeldig JSON response van LM Studio');
    }

    return { subject: parsed.subject, body: parsed.body, source: 'lm-studio' };
}

async function processWithClaude(transcript) {
    const token = localStorage.getItem('sanityDashToken');
    if (!token) throw new Error('Geen auth token');

    const response = await fetch('/api/mail-rewrite', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ transcript })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Claude API error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    if (!data.subject || !data.body) {
        throw new Error('Claude response mist velden');
    }

    return { subject: data.subject, body: data.body, source: 'claude' };
}

// Hoofdfunctie: probeer LM Studio, val terug op Claude
export async function generateMail(transcript, onStatus) {
    if (!transcript || !transcript.trim()) {
        throw new Error('Transcript is leeg');
    }

    const prompt = await loadPrompt();
    if (!prompt) throw new Error('Fappiewriter prompt niet geladen');

    onStatus && onStatus('LM Studio controleren…');
    const lm = await checkLMStudio(true);

    if (lm.ok) {
        onStatus && onStatus(`Lokaal (${lm.modelId}) — dit kan een minuut duren`);
        try {
            return await processWithLMStudio(transcript, prompt, lm.modelId);
        } catch (error) {
            console.warn('[mail] LM Studio failed, falling back to Claude:', error);
            onStatus && onStatus('LM Studio faalde — terugvallen op Claude');
        }
    } else {
        onStatus && onStatus('LM Studio offline — Claude wordt gebruikt');
    }

    return await processWithClaude(transcript);
}
