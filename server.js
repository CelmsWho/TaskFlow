const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(express.static('public'));

const JWT_SECRET = process.env.JWT_SECRET || 'tava_slepena_atslēga_šeit';

const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'taskflow_db'
});

db.connect((err) => {
    if (err) {
        console.error('Kļūda pieslēdzoties MySQL:', err);
        return;
    }
    console.log('Veiksmīgi pieslēgts MySQL datubāzei!');

    const createUserTable = `
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL
        )
    `;
    
    const createTaskTable = `
        CREATE TABLE IF NOT EXISTS tasks (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            priority VARCHAR(50) DEFAULT 'Medium',
            due_date VARCHAR(50),
            status VARCHAR(50) DEFAULT 'active',
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `;

    db.query(createUserTable, (err) => {
        if (err) console.error('Kļūda izveidojot users tabulu:', err);
    });
    db.query(createTaskTable, (err) => {
        if (err) console.error('Kļūda izveidojot tasks tabulu:', err);
    });
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/login.html');
});

// Autentifikācija
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Lūdzu, aizpildi visus laukus' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const query = 'INSERT INTO users (name, email, password) VALUES (?, ?, ?)';
        
        db.query(query, [name, email, hashedPassword], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ error: 'E-pasts jau ir reģistrēts' });
                }
                return res.status(500).json({ error: err.message });
            }

            const userId = result.insertId;
            const token = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: '24h' });
            
            res.status(201).json({
                message: 'Lietotājs veiksmīgi reģistrēts',
                token,
                user: { id: userId, name, email }
            });
        });
    } catch (err) {
        res.status(500).json({ error: 'Servera kļūda' });
    }
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Lūdzu, ievadi e-pastu un paroli' });
    }

    const query = 'SELECT * FROM users WHERE email = ?';
    db.query(query, [email], async (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) {
            return res.status(401).json({ error: 'Nepareizs e-pasts vai parole' });
        }

        const user = results[0];
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Nepareizs e-pasts vai parole' });
        }

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
        res.json({
            message: 'Veiksmīga pieteikšanās',
            token,
            user: { id: user.id, name: user.name, email: user.email }
        });
    });
});

function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Nav autorizācijas tokena' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Nederīgs vai beidzies tokens' });
        req.user = user;
        next();
    });
}

// Uzdevumu CRUD
app.get('/api/tasks', verifyToken, (req, res) => {
    const userId = req.user.id;
    const query = 'SELECT * FROM tasks WHERE user_id = ? ORDER BY id DESC';
    db.query(query, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/tasks', verifyToken, (req, res) => {
    const { title, description, priority, due_date } = req.body;
    const userId = req.user.id;

    if (!title) return res.status(400).json({ error: 'Uzdevuma nosaukums ir obligāts' });

    const query = 'INSERT INTO tasks (user_id, title, description, priority, due_date, status) VALUES (?, ?, ?, ?, ?, "active")';
    db.query(query, [userId, title, description || '', priority || 'Medium', due_date || 'Nenorādīts'], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: 'Uzdevums veiksmīgi izveidots', taskId: result.insertId });
    });
});

app.patch('/api/tasks/:id/toggle', verifyToken, (req, res) => {
    const taskId = req.params.id;
    const { status } = req.body;
    const userId = req.user.id;

    const query = 'UPDATE tasks SET status = ? WHERE id = ? AND user_id = ?';
    db.query(query, [status, taskId, userId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Uzdevums nav atrasts' });
        res.json({ message: 'Uzdevuma statuss atjaunināts' });
    });
});

app.delete('/api/tasks/:id', verifyToken, (req, res) => {
    const taskId = req.params.id;
    const userId = req.user.id;

    const query = 'DELETE FROM tasks WHERE id = ? AND user_id = ?';
    db.query(query, [taskId, userId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Uzdevums nav atrasts' });
        res.json({ message: 'Uzdevums veiksmīgi izdzēsts' });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveris palaists un darbojas uz http://localhost:${PORT}`);
});