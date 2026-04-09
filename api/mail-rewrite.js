import { readFileSync } from 'fs';
import path from 'path';

// Cache prompt in module scope — herlaad alleen bij cold start
let cachedPrompt = null;
function loadFappiewriterPrompt() {
    if (cachedPrompt) return cachedPrompt;
    try {
        const promptPath = path.join(process.cwd(), 'prompts', 'fappiewriter-mails.md');
        cachedPrompt = readFileSync(promptPath, 'utf8');
        return cachedPrompt;
    } catch (error) {
        console.error('Failed to load fappiewriter prompt:', error);
        return null;
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Auth check (zelfde patroon als api/quick-add.js)
    const appPassword = process.env.APP_PASSWORD;
    const providedToken = (req.headers.authorization || '').replace('Bearer ', '');
    const expectedToken = appPassword
        ? Buffer.from(appPassword + '_sanitydash_auth').toString('base64')
        : null;

    if (!expectedToken || providedToken !== expectedToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { transcript, context } = req.body || {};
    if (!transcript || typeof transcript !== 'string') {
        return res.status(400).json({ error: 'Transcript is required' });
    }

    function buildContextBlock(ctx) {
        if (!ctx) return '';
        const lines = [];
        if (ctx.naam) lines.push(`- Ontvanger (uit de taak): ${ctx.naam}`);
        if (ctx.taak) lines.push(`- Onderwerp volgens taak: ${ctx.taak}`);
        if (lines.length === 0) return '';
        return [
            'Context over deze mail:',
            ...lines,
            `Gebruik de naam van de ontvanger in de aanhef (bv. "Hoi ${ctx.naam || '[naam]'},"). Negeer deze context alleen als het transcript expliciet een andere ontvanger noemt.`,
            ''
        ].join('\n');
    }
    const contextBlock = buildContextBlock(context);

    const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
    if (!CLAUDE_API_KEY) {
        return res.status(500).json({ error: 'Claude API key not configured' });
    }

    const systemPrompt = loadFappiewriterPrompt();
    if (!systemPrompt) {
        return res.status(500).json({ error: 'Fappiewriter prompt not found' });
    }

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-5',
                max_tokens: 2048,
                system: [
                    {
                        type: 'text',
                        text: systemPrompt,
                        cache_control: { type: 'ephemeral' }
                    }
                ],
                messages: [
                    {
                        role: 'user',
                        content: `${contextBlock}Herschrijf onderstaand transcript naar een nette zakelijke mail. Retourneer ALLEEN een JSON object met velden "subject" en "body".\n\nTranscript:\n${transcript}`
                    }
                ]
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('Claude API error:', errorData);
            return res.status(response.status).json({ error: 'Claude API error', details: errorData });
        }

        const data = await response.json();
        const content = data.content[0].text;

        // Parse JSON (met fallback voor markdown fences)
        let parsed = null;
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    parsed = JSON.parse(jsonMatch[0]);
                } catch (e2) {
                    // fall through
                }
            }
        }

        if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
            return res.status(500).json({
                error: 'Invalid response format from model',
                raw: content
            });
        }

        return res.status(200).json({
            subject: parsed.subject,
            body: parsed.body
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}
