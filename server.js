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
        initDatabaseTables();
        migrateSchema();
    }
});

// Salabo vecākas DB versijas: pievieno trūkstošās kolonnas un
// padara nezināmas obligātās kolonnas neobligātas, lai INSERT nenobrūk.
const EXPECTED_COLUMNS = {
    users: { name: 'VARCHAR(255) NULL' },
    tasks: {
        user_id: 'INT NULL', title: "VARCHAR(255) NOT NULL DEFAULT ''", description: 'TEXT NULL',
        priority: "VARCHAR(50) DEFAULT 'Medium'", task_date: "VARCHAR(100) DEFAULT 'Šodien'", completed: 'BOOLEAN DEFAULT FALSE'
    },
    projects: { owner_id: 'INT NULL', title: "VARCHAR(255) NOT NULL DEFAULT ''", description: 'TEXT NULL' },
    project_tasks: {
        project_id: 'INT NULL', title: "VARCHAR(255) NOT NULL DEFAULT ''", description: 'TEXT NULL',
        priority: "VARCHAR(50) DEFAULT 'Medium'", status: "VARCHAR(50) DEFAULT 'todo'",
        task_date: 'VARCHAR(100) NULL', assignee: 'VARCHAR(10) NULL'
    },
    invitations: {
        project_id: 'INT NULL', user_id: 'INT NULL', project_name: "VARCHAR(255) NOT NULL DEFAULT ''", sender: "VARCHAR(255) NOT NULL DEFAULT ''",
        status: "ENUM('pending','accepted','rejected') DEFAULT 'pending'"
    }
};

function migrateSchema() {
    Object.entries(EXPECTED_COLUMNS).forEach(([table, expected]) => {
        db.query(
            `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
            [table],
            (err, rows) => {
                if (err) return console.error('Migrācija neizdevās:', table, err.message);
                const existing = {};
                rows.forEach(r => { existing[r.COLUMN_NAME || r.column_name] = r; });

                Object.entries(expected).forEach(([col, ddl]) => {
                    if (!existing[col]) {
                        db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${ddl}`, (e) => {
                            if (e) console.error(`Neizdevās pievienot ${table}.${col}:`, e.message);
                            else console.log(`Migrācija: pievienota kolonna ${table}.${col}`);
                        });
                    }
                });

                // vecā kolonna user_id -> owner_id
                if (table === 'projects' && !existing.owner_id && existing.user_id) {
                    db.query('UPDATE projects SET owner_id = user_id WHERE owner_id IS NULL');
                }

                // nezināmas obligātas kolonnas bez noklusējuma -> NULL
                Object.values(existing).forEach(r => {
                    const name = r.COLUMN_NAME || r.column_name;
                    if (expected[name] || r.COLUMN_KEY === 'PRI' || (r.EXTRA || '').includes('auto_increment')) return;
                    if (r.IS_NULLABLE === 'NO' && r.COLUMN_DEFAULT === null) {
                        db.query(`ALTER TABLE \`${table}\` MODIFY \`${name}\` ${r.COLUMN_TYPE} NULL`, (e) => {
                            if (!e) console.log(`Migrācija: ${table}.${name} tagad drīkst būt NULL`);
                        });
                    }
                });
            }
        );
    });
}

function initDatabaseTables() {
    db.query(`CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL
    )`);

    db.query(`CREATE TABLE IF NOT EXISTS tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        priority VARCHAR(50) DEFAULT 'Medium',
        task_date VARCHAR(100) DEFAULT 'Šodien',
        completed BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    db.query(`CREATE TABLE IF NOT EXISTS projects (
        id INT AUTO_INCREMENT PRIMARY KEY,
        owner_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    db.query(`CREATE TABLE IF NOT EXISTS project_tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        priority VARCHAR(50) DEFAULT 'Medium',
        status VARCHAR(50) DEFAULT 'todo',
        task_date VARCHAR(100),
        assignee VARCHAR(10),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )`);

    db.query(`CREATE TABLE IF NOT EXISTS project_members (
        project_id INT NOT NULL,
        user_id INT NOT NULL,
        PRIMARY KEY (project_id, user_id)
    )`);

    db.query(`CREATE TABLE IF NOT EXISTS invitations (
        project_id INT NULL,
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        project_name VARCHAR(255) NOT NULL,
        sender VARCHAR(255) NOT NULL,
        status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
}

// Žurnalē DB kļūdu un atgriež lasāmu iemeslu
function dbError(res, err) {
    console.error('DB kļūda:', err.code, err.sqlMessage || err.message);
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(401).json({ error: 'Lietotājs datubāzē nav atrasts. Izraksties un piesakies vēlreiz.' });
    }
    res.status(500).json({ error: 'Datubāzes kļūda', detail: `${err.code}: ${err.sqlMessage || err.message}` });
}

const JWT_SECRET = process.env.JWT_SECRET || 'taskflow_secret_key';

function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Nav autorizācijas tokena' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Nederīgs tokens' });
        req.user = user;
        next();
    });
}

// Autentifikācija
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Aizpildiet visus laukus' });
    if (password.length < 6) return res.status(400).json({ error: 'Parolei jābūt vismaz 6 simbolu garai' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.query('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name, email, hashedPassword], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'E-pasts jau reģistrēts' });
                return res.status(500).json({ error: 'Datubāzes kļūda' });
            }
            const userId = result.insertId;
            
            db.query('INSERT INTO projects (owner_id, title, description) VALUES (?, ?, ?)', [userId, 'Mājas Lapas Redizains', 'Komandas projekts jaunas e-komercijas platformas izstrādei'], (err, projRes) => {
                if (!err) {
                    const projId = projRes.insertId;
                    db.query('INSERT INTO project_tasks (project_id, title, description, priority, status, task_date, assignee) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [projId, 'UI/UX Pētījums un Wireframes', 'Analizēt konkurentu mērķlapas', 'High', 'todo', '18. Okt', 'AN']);
                    db.query('INSERT INTO project_tasks (project_id, title, description, priority, status, task_date, assignee) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [projId, 'Figma Auth ekrānu prototipēšana', 'Login un Register SVG koda izveide', 'Medium', 'in_progress', 'Rīt', 'JB']);
                }
            });
            db.query('INSERT INTO invitations (user_id, project_name, sender, status) VALUES (?, ?, ?, ?)', [userId, 'Mobilā Lietotne', 'Kārlis Ozols', 'pending']);

            const token = jwt.sign({ id: userId, email, name }, JWT_SECRET, { expiresIn: '24h' });
            res.status(201).json({ token, user: { id: userId, name, email } });
        });
    } catch (err) {
        res.status(500).json({ error: 'Servera kļūda' });
    }
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
        if (err || results.length === 0) return res.status(401).json({ error: 'Nepareizs e-pasts vai parole' });
        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Nepareizs e-pasts vai parole' });

        const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    });
});

// Privāto uzdevumu API
app.get('/api/tasks', verifyToken, (req, res) => {
    db.query('SELECT * FROM tasks WHERE user_id = ? ORDER BY id DESC', [req.user.id], (err, results) => {
        if (err) return dbError(res, err);
        res.json(results);
    });
});

app.post('/api/tasks', verifyToken, (req, res) => {
    const { title, description, priority, task_date } = req.body;
    db.query('INSERT INTO tasks (user_id, title, description, priority, task_date, completed) VALUES (?, ?, ?, ?, ?, false)',
        [req.user.id, title, description || '', priority || 'Medium', task_date || 'Šodien'], (err, result) => {
            if (err) return dbError(res, err);
            res.status(201).json({ id: result.insertId });
        });
});

app.patch('/api/tasks/:id', verifyToken, (req, res) => {
    db.query('UPDATE tasks SET completed = ? WHERE id = ? AND user_id = ?', [req.body.completed ? 1 : 0, req.params.id, req.user.id], (err) => {
        if (err) return dbError(res, err);
        res.json({ message: 'OK' });
    });
});

app.delete('/api/tasks/:id', verifyToken, (req, res) => {
    db.query('DELETE FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err) => {
        if (err) return dbError(res, err);
        res.json({ message: 'OK' });
    });
});

// Projektu un Kanban API
app.get('/api/projects', verifyToken, (req, res) => {
    db.query('SELECT * FROM projects p WHERE p.owner_id = ? OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)', [req.user.id, req.user.id], (err, results) => {
        if (err) return dbError(res, err);
        res.json(results);
    });
});

app.post('/api/projects', verifyToken, (req, res) => {
    const { title, description } = req.body;
    db.query('INSERT INTO projects (owner_id, title, description) VALUES (?, ?, ?)', [req.user.id, title, description || ''], (err, result) => {
        if (err) return dbError(res, err);
        res.status(201).json({ id: result.insertId, title, description });
    });
});

function ownsProject(userId, projectId, res, next) {
    db.query('SELECT p.id FROM projects p WHERE p.id = ? AND (p.owner_id = ? OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?))', [projectId, userId, userId], (err, rows) => {
        if (err) return dbError(res, err);
        if (rows.length === 0) return res.status(404).json({ error: 'Projekts nav atrasts' });
        next();
    });
}

app.get('/api/projects/:id/tasks', verifyToken, (req, res) => {
    ownsProject(req.user.id, req.params.id, res, () => {
        db.query('SELECT * FROM project_tasks WHERE project_id = ?', [req.params.id], (err, results) => {
            if (err) return dbError(res, err);
            res.json(results);
        });
    });
});

app.post('/api/projects/:id/tasks', verifyToken, (req, res) => {
    const { title, description, priority, status, task_date, assignee } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Nosaukums ir obligāts' });
    ownsProject(req.user.id, req.params.id, res, () =>
    db.query('INSERT INTO project_tasks (project_id, title, description, priority, status, task_date, assignee) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.params.id, title, description || '', priority || 'Medium', status || 'todo', task_date || 'Šodien', assignee || 'JB'], (err, result) => {
            if (err) return dbError(res, err);
            res.status(201).json({ id: result.insertId });
        }));
});

// Kanban statusa maiņas maršruts
app.patch('/api/project-tasks/:id', verifyToken, (req, res) => {
    const { status } = req.body;
    if (!['todo', 'in_progress', 'done'].includes(status)) return res.status(400).json({ error: 'Nederīgs statuss' });
    db.query('UPDATE project_tasks pt JOIN projects p ON p.id = pt.project_id SET pt.status = ? WHERE pt.id = ? AND (p.owner_id = ? OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?))', [status, req.params.id, req.user.id, req.user.id], (err) => {
        if (err) return dbError(res, err);
        res.json({ message: 'OK' });
    });
});

// Uzaicinājumu API
app.get('/api/invitations', verifyToken, (req, res) => {
    db.query('SELECT * FROM invitations WHERE user_id = ? AND status = "pending"', [req.user.id], (err, results) => {
        if (err) return dbError(res, err);
        res.json(results);
    });
});

app.post('/api/invitations/:id/respond', verifyToken, (req, res) => {
    const { status } = req.body;
    if (!['accepted', 'rejected'].includes(status)) return res.status(400).json({ error: 'Nederīgs statuss' });
    db.query('UPDATE invitations SET status = ? WHERE id = ? AND user_id = ? AND status = "pending"', [status, req.params.id, req.user.id], (err, upd) => {
        if (err) return dbError(res, err);
        if (status === 'accepted' && upd.affectedRows > 0) {
            db.query('SELECT * FROM invitations WHERE id = ?', [req.params.id], (err, invRes) => {
                if (!err && invRes.length > 0) {
                    if (invRes[0].project_id) {
                        db.query('INSERT IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)', [invRes[0].project_id, req.user.id]);
                    } else {
                        db.query('INSERT INTO projects (owner_id, title, description) VALUES (?, ?, ?)', [req.user.id, invRes[0].project_name, 'Pievienots caur uzaicinājumu']);
                    }
                }
            });
        }
        res.json({ message: 'OK' });
    });
});

// ---- Uzdevumu un projektu labošana / dzēšana ----
const PRIORITIES = ['Low', 'Medium', 'High'];

function canAccessProjectTask(userId, taskId, res, next) {
    db.query('SELECT pt.id FROM project_tasks pt JOIN projects p ON p.id = pt.project_id WHERE pt.id = ? AND (p.owner_id = ? OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?))', [taskId, userId, userId], (err, rows) => {
        if (err) return dbError(res, err);
        if (rows.length === 0) return res.status(404).json({ error: 'Uzdevums nav atrasts' });
        next();
    });
}

function ownerOnly(userId, projectId, res, next) {
    db.query('SELECT id FROM projects WHERE id = ? AND owner_id = ?', [projectId, userId], (err, rows) => {
        if (err) return dbError(res, err);
        if (rows.length === 0) return res.status(403).json({ error: 'Tikai projekta īpašnieks var veikt šo darbību' });
        next();
    });
}

app.put('/api/tasks/:id', verifyToken, (req, res) => {
    const { title, description, priority, task_date } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Nosaukums ir obligāts' });
    if (!PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Nederīga prioritāte' });
    db.query('UPDATE tasks SET title = ?, description = ?, priority = ?, task_date = ? WHERE id = ? AND user_id = ?',
        [title.trim(), description || '', priority, task_date || 'Šodien', req.params.id, req.user.id], (err, r) => {
            if (err) return dbError(res, err);
            if (r.affectedRows === 0) return res.status(404).json({ error: 'Uzdevums nav atrasts' });
            res.json({ message: 'OK' });
        });
});

app.put('/api/project-tasks/:id', verifyToken, (req, res) => {
    const { title, description, priority, status, task_date } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Nosaukums ir obligāts' });
    if (!PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Nederīga prioritāte' });
    if (!['todo', 'in_progress', 'done'].includes(status)) return res.status(400).json({ error: 'Nederīgs statuss' });
    canAccessProjectTask(req.user.id, req.params.id, res, () => {
        db.query('UPDATE project_tasks SET title = ?, description = ?, priority = ?, status = ?, task_date = ? WHERE id = ?',
            [title.trim(), description || '', priority, status, task_date || null, req.params.id], (err) => {
                if (err) return dbError(res, err);
                res.json({ message: 'OK' });
            });
    });
});

app.delete('/api/project-tasks/:id', verifyToken, (req, res) => {
    canAccessProjectTask(req.user.id, req.params.id, res, () => {
        db.query('DELETE FROM project_tasks WHERE id = ?', [req.params.id], (err) => {
            if (err) return dbError(res, err);
            res.json({ message: 'OK' });
        });
    });
});

app.put('/api/projects/:id', verifyToken, (req, res) => {
    const { title, description } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Nosaukums ir obligāts' });
    ownerOnly(req.user.id, req.params.id, res, () => {
        db.query('UPDATE projects SET title = ?, description = ? WHERE id = ?', [title.trim(), description || '', req.params.id], (err) => {
            if (err) return dbError(res, err);
            res.json({ message: 'OK' });
        });
    });
});

app.delete('/api/projects/:id', verifyToken, (req, res) => {
    const id = req.params.id;
    ownerOnly(req.user.id, id, res, () => {
        db.query('DELETE FROM project_tasks WHERE project_id = ?', [id], (e1) => {
            if (e1) return dbError(res, e1);
            db.query('DELETE FROM project_members WHERE project_id = ?', [id], (e2) => {
                if (e2) return dbError(res, e2);
                db.query('DELETE FROM invitations WHERE project_id = ?', [id], (e3) => {
                    if (e3) return dbError(res, e3);
                    db.query('DELETE FROM projects WHERE id = ?', [id], (e4) => {
                        if (e4) return dbError(res, e4);
                        res.json({ message: 'OK' });
                    });
                });
            });
        });
    });
});

// Dalībnieks atsakās no projekta (īpašnieks nevar - viņam jādzēš projekts)
app.post('/api/projects/:id/leave', verifyToken, (req, res) => {
    db.query('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, req.user.id], (err, r) => {
        if (err) return dbError(res, err);
        if (r.affectedRows === 0) return res.status(400).json({ error: 'Īpašnieks nevar atteikties no sava projekta - to var tikai dzēst' });
        res.json({ message: 'OK' });
    });
});

// Projekta dalībnieki (īpašnieks + pievienotie)
app.get('/api/projects/:id/members', verifyToken, (req, res) => {
    ownsProject(req.user.id, req.params.id, res, () => {
        db.query(
            `SELECT u.id, u.name FROM users u WHERE u.id = (SELECT owner_id FROM projects WHERE id = ?)
             UNION
             SELECT u.id, u.name FROM users u JOIN project_members m ON m.user_id = u.id WHERE m.project_id = ?`,
            [req.params.id, req.params.id],
            (err, rows) => {
                if (err) return dbError(res, err);
                res.json(rows);
            }
        );
    });
});

// Uzaicināt lietotāju projektā pēc e-pasta
app.post('/api/projects/:id/invite', verifyToken, (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Ievadiet e-pastu' });
    ownsProject(req.user.id, req.params.id, res, () => {
        db.query('SELECT id FROM users WHERE LOWER(email) = ?', [email], (err, users) => {
            if (err) return dbError(res, err);
            if (users.length === 0) return res.status(404).json({ error: 'Lietotājs ar šādu e-pastu nav atrasts' });
            const invitee = users[0].id;
            db.query(
                `SELECT 1 FROM projects p WHERE p.id = ? AND (p.owner_id = ? OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?))
                 UNION SELECT 1 FROM invitations WHERE project_id = ? AND user_id = ? AND status = 'pending'`,
                [req.params.id, invitee, invitee, req.params.id, invitee],
                (err, dup) => {
                    if (err) return dbError(res, err);
                    if (dup.length > 0) return res.status(400).json({ error: 'Lietotājs jau ir komandā vai uzaicināts' });
                    db.query('SELECT title FROM projects WHERE id = ?', [req.params.id], (err, pr) => {
                        if (err) return dbError(res, err);
                        db.query('INSERT INTO invitations (user_id, project_id, project_name, sender, status) VALUES (?, ?, ?, ?, ?)',
                            [invitee, req.params.id, pr[0].title, req.user.name, 'pending'], (err) => {
                                if (err) return dbError(res, err);
                                res.status(201).json({ message: 'OK' });
                            });
                    });
                }
            );
        });
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveris palaists uz http://localhost:${PORT}`);
});