export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const token = req.headers.authorization?.replace('Bearer ', '') || req.body.token;
    const correctPassword = process.env.APP_PASSWORD;

    if (!correctPassword) {
        return res.status(500).json({ error: 'Password not configured' });
    }

    const expectedToken = Buffer.from(correctPassword + '_sanitydash_auth').toString('base64');

    if (token === expectedToken) {
        return res.status(200).json({ valid: true });
    }

    return res.status(401).json({ valid: false });
}
