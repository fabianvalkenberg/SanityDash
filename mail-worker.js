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

async function callLMStudio(body) {
    const response = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000)
    });

    if (!response.ok) {
        const errText = await response.text();
        const err = new Error(`LM Studio HTTP ${response.status}: ${errText.slice(0, 300)}`);
        err.status = response.status;
        err.rawBody = errText;
        throw err;
    }

    const data = await response.json();
    return data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : '';
}

async function processWithLMStudio(transcript, prompt, modelId, context) {
    const systemPrompt = prompt + [
        '',
        '',
        'BELANGRIJK voor je output:',
        '- Retourneer ALLEEN een JSON object met exact twee string-velden: "subject" en "body".',
        '- Geen uitleg vooraf of achteraf.',
        '- Geen markdown code fences.',
        '- Geen <think>...</think> reasoning tokens in de output.',
        '- Het eerste teken van je antwoord moet { zijn, het laatste }.',
        '',
        'Voorbeeld van geldig antwoord:',
        '{"subject": "Terugkoppeling gesprek", "body": "Hoi,\\n\\nHier is de mail...\\n\\nGroet,\\nFabian"}'
    ].join('\n');
    const contextBlock = buildContextBlock(context);
    const userMessage = `${contextBlock}Herschrijf onderstaand transcript naar een nette zakelijke mail en geef ALLEEN het JSON object terug:\n\n${transcript}`;

    const baseBody = {
        model: modelId || 'local-model',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        stream: false
    };

    // Strategie: probeer eerst plain (meest compatibel met reasoning models).
    // LM Studio ondersteunt alleen 'json_schema' of 'text', niet 'json_object'.
    // Als plain niet lukt, val terug op json_schema strict.
    const attempts = [
        { label: 'plain', body: baseBody },
        {
            label: 'json_schema',
            body: {
                ...baseBody,
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'mail',
                        strict: true,
                        schema: {
                            type: 'object',
                            properties: {
                                subject: { type: 'string' },
                                body: { type: 'string' }
                            },
                            required: ['subject', 'body'],
                            additionalProperties: false
                        }
                    }
                }
            }
        }
    ];

    let lastError = null;
    for (const attempt of attempts) {
        try {
            const content = await callLMStudio(attempt.body);
            const parsed = extractJson(content);
            if (parsed && typeof parsed.subject === 'string' && typeof parsed.body === 'string') {
                return { subject: parsed.subject, body: parsed.body, source: 'lm-studio' };
            }
            console.warn(`[mail] LM Studio (${attempt.label}) returned invalid JSON:`, content.slice(0, 400));
            lastError = new Error(`Ongeldig JSON van LM Studio (${attempt.label})`);
            lastError.rawContent = content;
        } catch (error) {
            console.warn(`[mail] LM Studio (${attempt.label}) failed:`, error.message);
            lastError = error;
        }
    }

    throw lastError || new Error('LM Studio gaf geen bruikbaar antwoord');
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
