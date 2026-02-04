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

    const { password } = req.body;
    const correctPassword = process.env.APP_PASSWORD;

    if (!correctPassword) {
        return res.status(500).json({ error: 'Password not configured' });
    }

    if (password === correctPassword) {
        // Generate a simple token (hash of password + secret)
        const token = Buffer.from(correctPassword + '_sanitydash_auth').toString('base64');
        return res.status(200).json({ success: true, token });
    }

    return res.status(401).json({ error: 'Incorrect password' });
}
