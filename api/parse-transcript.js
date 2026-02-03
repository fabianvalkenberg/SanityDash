export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { transcript, contacten } = req.body;

    if (!transcript) {
        return res.status(400).json({ error: 'Transcript is required' });
    }

    const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

    if (!CLAUDE_API_KEY) {
        return res.status(500).json({ error: 'Claude API key not configured' });
    }

    const systemPrompt = `Je bent een assistent die transcripts analyseert en taken extraheert.

BEKENDE CONTACTEN:
${contacten && contacten.length > 0 ? contacten.join(', ') : 'Geen contacten opgegeven'}

INSTRUCTIES:
Analyseer het transcript en extraheer alle taken. Categoriseer elke taak in één van deze drie categorieën:

1. PLANNEN - Taken die tijd kosten om uit te voeren (projecten, administratie, etc.)
   - Schat de tijd in: 1, 2, 3, of 6 uur
   - Let op woorden als: "moet ik doen", "ga ik maken", "uitwerken", "afronden"

2. BELLEN - Taken waarbij iemand gebeld moet worden
   - Let op woorden als: "even bellen", "telefonisch", "opbellen", "contact opnemen"
   - Koppel aan bekende contacten indien mogelijk

3. MAILEN - Taken waarbij een e-mail gestuurd moet worden
   - Let op woorden als: "mailen", "e-mail sturen", "mail", "schrijven naar"
   - Koppel aan bekende contacten indien mogelijk

GEBRUIK ALTIJD de correcte spelling van namen uit de bekende contacten lijst als die matchen.

Geef je antwoord ALLEEN als valid JSON in dit exacte formaat, zonder extra tekst:
{
  "planning": [{"titel": "Taaknaam", "uren": 2}],
  "bellen": [{"naam": "Contactnaam", "taak": "Korte beschrijving"}],
  "mailen": [{"naam": "Contactnaam", "taak": "Korte beschrijving"}]
}

Als er geen taken zijn in een categorie, geef een lege array [].`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 1024,
                messages: [
                    {
                        role: 'user',
                        content: `Analyseer dit transcript en extraheer de taken:\n\n${transcript}`
                    }
                ],
                system: systemPrompt
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('Claude API error:', errorData);
            return res.status(response.status).json({ error: 'Claude API error', details: errorData });
        }

        const data = await response.json();
        const content = data.content[0].text;

        // Parse de JSON response
        try {
            const tasks = JSON.parse(content);
            return res.status(200).json(tasks);
        } catch (parseError) {
            // Probeer JSON uit de response te extraheren
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const tasks = JSON.parse(jsonMatch[0]);
                return res.status(200).json(tasks);
            }
            return res.status(500).json({ error: 'Failed to parse Claude response', raw: content });
        }

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}
