require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'taskflow'
});

db.connect(err => {
    if (err) {
        console.error('Kļūda pieslēdzoties MySQL datubāzei:', err);
    } else {
        console.log(`Veiksmīgi pieslēgts MySQL datubāzei: ${process.env.DB_NAME || 'taskflow'}`);
    }
});

const JWT_SECRET = process.env.JWT_SECRET || 'taskflow_super_secret_key_2026';

function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Nav autorizācijas tokena' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Nederīgs vai novecojis tokens' });
        req.user = user;
        next();
    });
}

// Reģistrācija un autorizācija
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Lūdzu aizpildiet visus laukus' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.query(
            'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
            [name, email, hashedPassword],
            (err, result) => {
                if (err) {
                    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'E-pasts jau reģistrēts' });
                    return res.status(500).json({ error: 'Datubāzes kļūda' });
                }
                const token = jwt.sign({ id: result.insertId, email, name }, JWT_SECRET, { expiresIn: '24h' });
                res.status(201).json({ token, user: { id: result.insertId, name, email } });
            }
        );
    } catch (err) {
        res.status(500).json({ error: 'Servera kļūda' });
    }
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Ievadiet e-pastu un paroli' });

    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
        if (err || results.length === 0) return res.status(401).json({ error: 'Nepareizs e-pasts vai parole' });
        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Nepareizs e-pasts vai parole' });

        const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    });
});

// Uzdevumu API
app.get('/api/tasks', verifyToken, (req, res) => {
    db.query('SELECT * FROM tasks WHERE user_id = ? ORDER BY id DESC', [req.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Kļūda ielādējot uzdevumus' });
        res.json(results);
    });
});

app.post('/api/tasks', verifyToken, (req, res) => {
    const { title, description, priority, task_date } = req.body;
    if (!title) return res.status(400).json({ error: 'Nosaukums ir obligāts' });

    db.query(
        'INSERT INTO tasks (user_id, title, description, priority, task_date, completed) VALUES (?, ?, ?, ?, ?, false)',
        [req.user.id, title, description || '', priority || 'Medium', task_date || 'Šodien'],
        (err, result) => {
            if (err) return res.status(500).json({ error: 'Kļūda saglabājot uzdevumu' });
            res.status(201).json({ id: result.insertId, message: 'Uzdevums izveidots' });
        }
    );
});

app.patch('/api/tasks/:id', verifyToken, (req, res) => {
    db.query('UPDATE tasks SET completed = ? WHERE id = ? AND user_id = ?', [req.body.completed ? 1 : 0, req.params.id, req.user.id], (err) => {
        if (err) return res.status(500).json({ error: 'Kļūda atjauninot' });
        res.json({ message: 'Atjaunināts' });
    });
});

app.delete('/api/tasks/:id', verifyToken, (req, res) => {
    db.query('DELETE FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err) => {
        if (err) return res.status(500).json({ error: 'Kļūda dzēšot' });
        res.json({ message: 'Dzēsts' });
    });
});

// Projektu API
app.get('/api/projects', verifyToken, (req, res) => {
    db.query('SELECT * FROM projects WHERE user_id = ?', [req.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Kļūda' });
        res.json(results);
    });
});

// Uzaicinājumu API
app.get('/api/invitations', verifyToken, (req, res) => {
    db.query('SELECT * FROM invitations WHERE user_id = ?', [req.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Kļūda' });
        res.json(results);
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveris palaists uz http://localhost:${PORT}`);
});