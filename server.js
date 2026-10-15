const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// MySQL datubāzes baseināšana
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// Automātiskā tabulu izveide startējot serveri
async function initDB() {
    try {
        // Pārliecināmies, ka datubāze eksistē vai pieslēdzamies tai
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                priority ENUM('High', 'Medium', 'Low') DEFAULT 'Medium',
                status ENUM('active', 'completed') DEFAULT 'active',
                due_date VARCHAR(100),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('MySQL datubāze tabulas veiksmīgi sagatavotas!');
    } catch (err) {
        console.error('Datubāzes inicializācijas kļūda:', err);
    }
}
initDB();

// JWT Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Nav piekļuves pilnvaras' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Nederīga pilnvara' });
        req.user = user;
        next();
    });
}

// --- AUTORIZĀCIJA ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await pool.query(
            'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
            [name, email, hashedPassword]
        );

        const token = jwt.sign({ id: result.insertId, email }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: result.insertId, name, email } });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ error: 'E-pasts jau ir reģistrēts' });
        } else {
            res.status(500).json({ error: 'Servera kļūda reģistrējoties' });
        }
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

        if (users.length === 0) return res.status(400).json({ error: 'Nepareizs e-pasts vai parole' });

        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: 'Nepareizs e-pasts vai parole' });

        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    } catch (err) {
        res.status(500).json({ error: 'Servera kļūda pieteicaties' });
    }
});

// --- UZDEVUMU API ---
app.get('/api/tasks', authenticateToken, async (req, res) => {
    try {
        const [tasks] = await pool.query('SELECT * FROM tasks WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
        res.json(tasks);
    } catch (err) {
        res.status(500).json({ error: 'Neizdevās ielādēt uzdevumus' });
    }
});

app.post('/api/tasks', authenticateToken, async (req, res) => {
    try {
        const { title, description, priority, due_date } = req.body;
        const [result] = await pool.query(
            'INSERT INTO tasks (user_id, title, description, priority, due_date) VALUES (?, ?, ?, ?, ?)',
            [req.user.id, title, description || '', priority || 'Medium', due_date || 'Šodien']
        );
        res.json({ id: result.insertId, title, description, priority, status: 'active' });
    } catch (err) {
        res.status(500).json({ error: 'Neizdevās izveidot uzdevumu' });
    }
});

app.patch('/api/tasks/:id/toggle', authenticateToken, async (req, res) => {
    try {
        const { status } = req.body;
        await pool.query('UPDATE tasks SET status = ? WHERE id = ? AND user_id = ?', [status, req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Neizdevās atjaunināt uzdevumu' });
    }
});

app.delete('/api/tasks/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Neizdevās dzēst uzdevumu' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MyTasks serveris palaists uz http://localhost:${PORT}`));