document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    const userName = localStorage.getItem('userName') || 'Admin';
    const initials = userName
        .split(' ')
        .filter(n => n.length > 0)
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);

    document.querySelectorAll('#user-name-display, #drawer-user-name').forEach(el => {
        if (el) el.textContent = userName;
    });

    document.querySelectorAll('#user-avatar, #mobile-user-avatar, #drawer-user-avatar').forEach(el => {
        if (el) el.textContent = initials;
    });

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userName');
        window.location.href = 'login.html';
    };

    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
    document.getElementById('drawer-logout-btn')?.addEventListener('click', handleLogout);

    let tasks = [];
    let currentFilter = 'All';
    let selectedTaskDate = 'Šodien';
    let activeView = 'tasks'; // 'tasks', 'projects', 'invitations'

    const taskListEl = document.getElementById('task-list');
    const completedTaskListEl = document.getElementById('completed-task-list');
    const countActiveEl = document.getElementById('count-active');
    const countCompletedEl = document.getElementById('count-completed');
    const countHighEl = document.getElementById('count-high');
    const completedHeaderEl = document.getElementById('completed-header');
    const mainHeaderTitle = document.querySelector('.main-header h1');

    async function loadTasks() {
        if (activeView !== 'tasks') return;
        try {
            const response = await fetch('/api/tasks', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                tasks = await response.json();
                renderTasks();
            } else if (response.status === 401 || response.status === 403) {
                handleLogout();
            }
        } catch (err) {
            console.error('Kļūda ielādējot uzdevumus:', err);
        }
    }

    async function loadProjects() {
        mainHeaderTitle.textContent = 'Kopīgie Projekti';
        taskListEl.innerHTML = '<p style="color: #94A3B8; padding: 20px;">Šeit tiks attēloti tavi kopīgie projekti.</p>';
        completedTaskListEl.innerHTML = '';
        if (completedHeaderEl) completedHeaderEl.style.display = 'none';
    }

    async function loadInvitations() {
        mainHeaderTitle.textContent = 'Uzaicinājumi';
        try {
            const res = await fetch('/api/invitations', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            taskListEl.innerHTML = data.length === 0 ? '<p style="color: #94A3B8; padding: 20px;">Nav jaunu uzaicinājumu.</p>' : '';
            data.forEach(inv => {
                taskListEl.innerHTML += `<div class="task-item"><p class="task-title-text">${inv.project_name}</p><span class="task-date">No: ${inv.sender}</span></div>`;
            });
        } catch (err) {
            taskListEl.innerHTML = '<p style="color: #94A3B8; padding: 20px;">Kļūda ielādējot uzaicinājumus.</p>';
        }
        completedTaskListEl.innerHTML = '';
        if (completedHeaderEl) completedHeaderEl.style.display = 'none';
    }

    // Navigācijas pogu pārslēgšana (Sānjosla un mobilā izvēlne)
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach((item, index) => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            const text = item.textContent.trim();
            if (text.includes('Uzdevumi')) {
                activeView = 'tasks';
                mainHeaderTitle.textContent = 'Mani Uzdevumi';
                if (completedHeaderEl) completedHeaderEl.style.display = 'block';
                loadTasks();
            } else if (text.includes('Projekti')) {
                activeView = 'projects';
                loadProjects();
            } else if (text.includes('Uzaicinājumi')) {
                activeView = 'invitations';
                loadInvitations();
            }

            // Aizver mobilo drawer, ja tāds ir atvērts
            document.getElementById('mobile-menu-drawer')?.classList.add('hidden');
        });
    });

    function renderTasks() {
        if (activeView !== 'tasks' || !taskListEl) return;
        taskListEl.innerHTML = '';
        completedTaskListEl.innerHTML = '';

        let activeCount = 0;
        let completedCount = 0;
        let highCount = 0;

        tasks.forEach(task => {
            const isCompleted = task.completed === 1 || task.completed === true;

            if (!isCompleted) {
                activeCount++;
                if (task.priority === 'High') highCount++;
            } else {
                completedCount++;
            }

            if (currentFilter !== 'All' && task.priority !== currentFilter && !isCompleted) {
                return;
            }

            const taskItem = document.createElement('div');
            taskItem.className = `task-item ${isCompleted ? 'completed' : ''}`;
            
            taskItem.innerHTML = `
                <div class="task-item-left">
                    <input type="checkbox" class="task-checkbox" ${isCompleted ? 'checked' : ''} data-id="${task.id}" />
                    <div>
                        <p class="task-title-text">${task.title}</p>
                        <p class="task-desc-text">${task.description || ''}</p>
                    </div>
                </div>
                <div class="task-item-right">
                    <span class="priority-badge badge-${task.priority.toLowerCase()}">${task.priority}</span>
                    <span class="task-date">${task.task_date || 'Šodien'}</span>
                    <div class="task-avatar">${initials}</div>
                    <button class="delete-btn" data-id="${task.id}">Dzēst</button>
                </div>
            `;

            if (isCompleted) {
                completedTaskListEl.appendChild(taskItem);
            } else {
                taskListEl.appendChild(taskItem);
            }
        });

        if (countActiveEl) countActiveEl.textContent = activeCount;
        if (countCompletedEl) countCompletedEl.textContent = completedCount;
        if (countHighEl) countHighEl.textContent = highCount;
        if (completedHeaderEl) {
            completedHeaderEl.style.display = 'block';
            completedHeaderEl.textContent = `PABEIGTIE UZDEVUMI (${completedCount})`;
        }
    }

    document.addEventListener('change', async (e) => {
        if (e.target.classList.contains('task-checkbox')) {
            const id = e.target.getAttribute('data-id');
            const completed = e.target.checked;
            try {
                await fetch(`/api/tasks/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ completed })
                });
                loadTasks();
            } catch (err) {
                console.error('Kļūda:', err);
            }
        }
    });

    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-btn')) {
            const id = e.target.getAttribute('data-id');
            try {
                await fetch(`/api/tasks/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                loadTasks();
            } catch (err) {
                console.error('Kļūda:', err);
            }
        }
    });

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.getAttribute('data-filter');
            renderTasks();
        });
    });

    const modal = document.getElementById('task-modal');
    const openModalBtn = document.getElementById('open-modal-btn');
    const mobileOpenModalBtn = document.getElementById('mobile-open-modal-btn');
    const cancelModalBtn = document.getElementById('cancel-modal-btn');
    const dragHandle = document.getElementById('modal-drag-handle');

    const toggleModal = (show) => {
        if (modal) {
            if (show) modal.classList.remove('hidden');
            else modal.classList.add('hidden');
        }
    };

    openModalBtn?.addEventListener('click', () => toggleModal(true));
    mobileOpenModalBtn?.addEventListener('click', () => toggleModal(true));
    cancelModalBtn?.addEventListener('click', () => toggleModal(false));
    dragHandle?.addEventListener('click', () => toggleModal(false));

    const priorityButtons = document.querySelectorAll('.priority-option');
    const priorityInput = document.getElementById('modal-priority');

    priorityButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            priorityButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (priorityInput) priorityInput.value = btn.getAttribute('data-priority');
        });
    });

    const taskForm = document.getElementById('modal-task-form');
    if (taskForm) {
        taskForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('modal-title').value;
            const description = document.getElementById('modal-description').value;
            const priority = priorityInput ? priorityInput.value : 'Medium';
            const task_date = selectedTaskDate;

            try {
                const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ title, description, priority, task_date })
                });

                if (response.ok) {
                    taskForm.reset();
                    if (priorityInput) priorityInput.value = 'Medium';
                    priorityButtons.forEach(b => {
                        if (b.getAttribute('data-priority') === 'Medium') b.classList.add('active');
                        else b.classList.remove('active');
                    });
                    selectedTaskDate = 'Šodien';
                    const dateBtnText = document.getElementById('date-btn-text');
                    if (dateBtnText) dateBtnText.textContent = 'Šodien';
                    toggleModal(false);
                    loadTasks();
                }
            } catch (err) {
                console.error('Kļūda:', err);
            }
        });
    }

    const calendarBtn = document.getElementById('calendar-btn');
    const hiddenDateInput = document.getElementById('hidden-date-input');
    const timePopup = document.getElementById('time-popup');
    const confirmTimeBtn = document.getElementById('confirm-time-btn');
    const popupTimeInput = document.getElementById('popup-time-input');
    const dateBtnText = document.getElementById('date-btn-text');
    let calendarDateValue = '';

    calendarBtn?.addEventListener('click', () => {
        hiddenDateInput.showPicker ? hiddenDateInput.showPicker() : hiddenDateInput.click();
    });

    hiddenDateInput?.addEventListener('change', (e) => {
        calendarDateValue = e.target.value;
        if (calendarDateValue && timePopup) timePopup.classList.remove('hidden');
    });

    confirmTimeBtn?.addEventListener('click', () => {
        const timeValue = popupTimeInput ? popupTimeInput.value : '12:00';
        if (calendarDateValue) {
            const selectedDate = new Date(calendarDateValue);
            const today = new Date();
            const tomorrow = new Date();
            tomorrow.setDate(today.getDate() + 1);

            const isToday = selectedDate.toDateString() === today.toDateString();
            const isTomorrow = selectedDate.toDateString() === tomorrow.toDateString();

            const months = ['janvāris', 'februāris', 'marts', 'aprīlis', 'maijs', 'jūnijs', 'jūlijs', 'augusts', 'septembris', 'oktobris', 'novembris', 'decembris'];
            const day = selectedDate.getDate();
            const month = months[selectedDate.getMonth()];

            let formatted = `${day}. ${month}`;
            if (isToday) formatted = 'Šodien';
            if (isTomorrow) formatted = 'Rīt';

            selectedTaskDate = `${formatted} ${timeValue}`;
            if (dateBtnText) dateBtnText.textContent = selectedTaskDate;
        }
        timePopup?.classList.add('hidden');
    });

    loadTasks();

    const hamburgerBtn = document.getElementById('hamburger-btn');
    const mobileMenuDrawer = document.getElementById('mobile-menu-drawer');
    const closeDrawerBtn = document.getElementById('close-drawer-btn');

    hamburgerBtn?.addEventListener('click', () => mobileMenuDrawer?.classList.remove('hidden'));
    closeDrawerBtn?.addEventListener('click', () => mobileMenuDrawer?.classList.add('hidden'));
});