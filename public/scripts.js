mkdir .env
document.addEventListener('DOMContentLoaded', () => {
    const authWrapper = document.getElementById('auth-wrapper');
    const dashboardView = document.getElementById('dashboard-view');
    const loginView = document.getElementById('login-view');
    const registerView = document.getElementById('register-view');

    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const taskForm = document.getElementById('task-form');
    const taskList = document.getElementById('task-list');
    const completedTaskList = document.getElementById('completed-task-list');

    const token = localStorage.getItem('token');
    const userName = localStorage.getItem('userName');
    if (token) {
        showDashboard(userName);
    }

    window.switchAuthView = function(view) {
        if (view === 'register') {
            loginView.classList.add('hidden');
            registerView.classList.remove('hidden');
        } else {
            registerView.classList.add('hidden');
            loginView.classList.remove('hidden');
        }
    };

    function showDashboard(name) {
        authWrapper.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        if (name) {
            document.getElementById('user-name-display').textContent = name;
            const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
            document.getElementById('user-avatar').textContent = initials;
        }
        loadTasks();
    }

    window.logout = function() {
        localStorage.removeItem('token');
        localStorage.removeItem('userName');
        dashboardView.classList.add('hidden');
        authWrapper.classList.remove('hidden');
        loginView.classList.remove('hidden');
        registerView.classList.add('hidden');
    };

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('register-name').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });
            const data = await res.json();
            if (res.ok) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('userName', data.user.name);
                showDashboard(data.user.name);
            } else {
                alert(data.error || 'Reģistrācijas kļūda');
            }
        } catch (err) {
            alert('Neizdevās savienoties ar serveri.');
        }
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (res.ok) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('userName', data.user.name);
                showDashboard(data.user.name);
            } else {
                alert(data.error || 'Nepareizs e-pasts vai parole');
            }
        } catch (err) {
            alert('Neizdevās savienoties ar serveri.');
        }
    });

    async function loadTasks() {
        const currentToken = localStorage.getItem('token');
        try {
            const res = await fetch('/api/tasks', {
                headers: { 'Authorization': `Bearer ${currentToken}` }
            });
            if (res.status === 401 || res.status === 403) {
                logout();
                return;
            }
            const tasks = await res.json();
            renderTasks(tasks);
        } catch (err) {
            console.error('Kļūda ielādējot uzdevumus:', err);
        }
    }

    function renderTasks(tasks) {
        taskList.innerHTML = '';
        completedTaskList.innerHTML = '';

        let activeCount = 0;
        let completedCount = 0;
        let highCount = 0;

        tasks.forEach(task => {
            const isCompleted = task.status === 'completed';
            
            if (isCompleted) {
                completedCount++;
                const item = document.createElement('div');
                item.className = 'task-item completed';
                item.innerHTML = `
                    <div class="task-item-left">
                        <input type="checkbox" checked onchange="toggleTask(${task.id}, 'active')" class="task-checkbox" />
                        <div>
                            <h4 class="task-title-text">${escapeHtml(task.title)}</h4>
                        </div>
                    </div>
                    <div class="task-item-right">
                        <span class="priority-badge badge-${task.priority.toLowerCase()}">${task.priority}</span>
                        <span class="task-date">${task.due_date}</span>
                        <button onclick="deleteTask(${task.id})" class="delete-btn">Dzēst</button>
                    </div>
                `;
                completedTaskList.appendChild(item);
            } else {
                activeCount++;
                if (task.priority === 'High') highCount++;

                const item = document.createElement('div');
                item.className = 'task-item';
                item.innerHTML = `
                    <div class="task-item-left">
                        <input type="checkbox" onchange="toggleTask(${task.id}, 'completed')" class="task-checkbox" />
                        <div>
                            <h4 class="task-title-text">${escapeHtml(task.title)}</h4>
                        </div>
                    </div>
                    <div class="task-item-right">
                        <span class="priority-badge badge-${task.priority.toLowerCase()}">${task.priority}</span>
                        <span class="task-date">${task.due_date}</span>
                        <button onclick="deleteTask(${task.id})" class="delete-btn">Dzēst</button>
                    </div>
                `;
                taskList.appendChild(item);
            }
        });

        document.getElementById('count-active').textContent = activeCount;
        document.getElementById('count-completed').textContent = completedCount;
        document.getElementById('count-high').textContent = highCount;
        document.getElementById('completed-header').textContent = `PABEIGTIE UZDEVUMI (${completedCount})`;
    }

    taskForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const titleInput = document.getElementById('task-title');
        const priorityInput = document.getElementById('task-priority');
        const title = titleInput.value.trim();
        const priority = priorityInput.value;

        if (!title) return;

        const currentToken = localStorage.getItem('token');
        try {
            const res = await fetch('/api/tasks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentToken}`
                },
                body: JSON.stringify({ title, priority, due_date: 'Šodien' })
            });

            if (res.ok) {
                titleInput.value = '';
                loadTasks();
            } else {
                alert('Neizdevās pievienot uzdevumu.');
            }
        } catch (err) {
            console.error('Kļūda:', err);
        }
    });

    window.toggleTask = async function(id, newStatus) {
        const currentToken = localStorage.getItem('token');
        try {
            await fetch(`/api/tasks/${id}/toggle`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentToken}`
                },
                body: JSON.stringify({ status: newStatus })
            });
            loadTasks();
        } catch (err) {
            console.error('Kļūda:', err);
        }
    };

    window.deleteTask = async function(id) {
        const currentToken = localStorage.getItem('token');
        try {
            await fetch(`/api/tasks/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${currentToken}` }
            });
            loadTasks();
        } catch (err) {
            console.error('Kļūda:', err);
        }
    };

    function escapeHtml(text) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.replace(/[&<>"']/g, function(m) { return map[m]; });
    }
});