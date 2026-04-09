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
    if (!text) return null;

    // 1. Strip <think>...</think> blokken (Qwen reasoning models)
    let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // 2. Strip markdown code fences (```json ... ``` of ``` ... ```)
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) cleaned = fenceMatch[1].trim();

    // 3. Probeer direct te parsen
    try {
        return JSON.parse(cleaned);
    } catch (e) {}

    // 4. Zoek het eerste balanced { ... } blok
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace >= 0) {
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = firstBrace; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    const slice = cleaned.slice(firstBrace, i + 1);
                    try {
                        return JSON.parse(slice);
                    } catch (e) {
                        return null;
                    }
                }
            }
        }
    }

    return null;
}

function buildContextBlock(context) {
    if (!context) return '';
    const lines = [];
    if (context.naam) lines.push(`- Ontvanger (uit de taak): ${context.naam}`);
    if (context.taak) lines.push(`- Onderwerp volgens taak: ${context.taak}`);
    if (lines.length === 0) return '';
    return [
        'Context over deze mail:',
        ...lines,
        'Gebruik de naam van de ontvanger in de aanhef (bv. "Hoi ' + (context.naam || '[naam]') + ',"). Negeer deze context alleen als het transcript expliciet een andere ontvanger noemt.',
        ''
    ].join('\n');
}

async function processWithLMStudio(transcript, prompt, modelId, context) {
    const systemPrompt = prompt + '\n\nBELANGRIJK: Retourneer ALLEEN een JSON object met de velden "subject" (string) en "body" (string). Geen thinking tokens, geen uitleg, geen markdown code fences — puur het JSON object.';
    const contextBlock = buildContextBlock(context);

    const response = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: modelId || 'local-model',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `${contextBlock}Herschrijf onderstaand transcript naar een nette zakelijke mail:\n\n${transcript}` }
            ],
            temperature: 0.5,
            stream: false,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'mail',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                            subject: { type: 'string', description: 'Korte concrete onderwerpregel' },
                            body: { type: 'string', description: 'Volledige mail-body met aanhef, inhoud en afsluiting' }
                        },
                        required: ['subject', 'body'],
                        additionalProperties: false
                    }
                }
            }
        }),
        signal: AbortSignal.timeout(180000)
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
        console.error('[mail] LM Studio raw response:', content);
        throw new Error('Ongeldig JSON response van LM Studio: ' + content.slice(0, 200));
    }

    return { subject: parsed.subject, body: parsed.body, source: 'lm-studio' };
}

async function processWithClaude(transcript, context) {
    const token = localStorage.getItem('sanityDashToken');
    if (!token) throw new Error('Geen auth token');

    const response = await fetch('/api/mail-rewrite', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ transcript, context })
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
// context: { naam, taak } — optioneel, wordt als hint meegegeven aan het model
export async function generateMail(transcript, onStatus, context) {
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
            return await processWithLMStudio(transcript, prompt, lm.modelId, context);
        } catch (error) {
            console.warn('[mail] LM Studio failed, falling back to Claude:', error);
            onStatus && onStatus('LM Studio faalde — terugvallen op Claude');
        }
    } else {
        onStatus && onStatus('LM Studio offline — Claude wordt gebruikt');
    }

    return await processWithClaude(transcript, context);
}
