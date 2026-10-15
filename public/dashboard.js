document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const userName = localStorage.getItem('userName');

    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    if (userName) {
        document.getElementById('user-name-display').textContent = userName;
        const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
        document.getElementById('user-avatar').textContent = initials;
    }

    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userName');
        window.location.href = 'login.html';
    });

    // Modālā loga un kalendāra pogas / popupa loģika
    const modal = document.getElementById('task-modal');
    const openModalBtn = document.getElementById('open-modal-btn');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const cancelModalBtn = document.getElementById('cancel-modal-btn');
    const modalTaskForm = document.getElementById('modal-task-form');

    let finalDueDate = '';
    let selectedDate = '';
    const calendarBtn = document.getElementById('calendar-btn');
    const hiddenDateInput = document.getElementById('hidden-date-input');
    const timePopup = document.getElementById('time-popup');
    const popupTimeInput = document.getElementById('popup-time-input');
    const confirmTimeBtn = document.getElementById('confirm-time-btn');
    const dateBtnText = document.getElementById('date-btn-text');

    calendarBtn.addEventListener('click', () => {
        if (hiddenDateInput.showPicker) {
            hiddenDateInput.showPicker();
        } else {
            hiddenDateInput.click();
        }
    });

    hiddenDateInput.addEventListener('change', (e) => {
        selectedDate = e.target.value;
        if (selectedDate) {
            timePopup.classList.remove('hidden');
        }
    });

    confirmTimeBtn.addEventListener('click', () => {
        const timeVal = popupTimeInput.value || '12:00';
        finalDueDate = `${selectedDate} ${timeVal}`;
        dateBtnText.textContent = formatFriendlyDate(finalDueDate);
        dateBtnText.style.color = '#F8FAFC';
        timePopup.classList.add('hidden');
    });

    openModalBtn.addEventListener('click', () => modal.classList.remove('hidden'));
    
    function closeModal() {
        modal.classList.add('hidden');
        timePopup.classList.add('hidden');
        modalTaskForm.reset();
        finalDueDate = '';
        selectedDate = '';
        dateBtnText.textContent = 'Izvēlēties datumu';
        dateBtnText.style.color = '#94A3B8';
    }

    closeModalBtn.addEventListener('click', closeModal);
    cancelModalBtn.addEventListener('click', closeModal);

    // Prioritāšu izvēle modālajā logā
    const priorityOptions = document.querySelectorAll('.priority-option');
    const modalPriorityInput = document.getElementById('modal-priority');

    priorityOptions.forEach(btn => {
        btn.addEventListener('click', () => {
            priorityOptions.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            modalPriorityInput.value = btn.getAttribute('data-priority');
        });
    });

    let currentFilter = 'All';
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.getAttribute('data-filter');
            loadTasks();
        });
    });

    let allTasks = [];

    loadTasks();

    async function loadTasks() {
        try {
            const res = await fetch('/api/tasks', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.status === 401 || res.status === 403) {
                localStorage.removeItem('token');
                window.location.href = 'login.html';
                return;
            }
            allTasks = await res.json();
            renderTasks();
        } catch (err) {
            console.error('Kļūda ielādējot uzdevumus:', err);
        }
    }

    function renderTasks() {
        const taskList = document.getElementById('task-list');
        const completedTaskList = document.getElementById('completed-task-list');

        taskList.innerHTML = '';
        completedTaskList.innerHTML = '';

        let activeCount = 0;
        let completedCount = 0;
        let highCount = 0;

        const filteredTasks = allTasks.filter(task => {
            if (task.status !== 'completed' && task.priority === 'High') {
                highCount++;
            }
            if (task.status === 'completed') {
                completedCount++;
            } else {
                activeCount++;
            }

            if (currentFilter === 'All') return true;
            return task.priority === currentFilter;
        });

        filteredTasks.forEach(task => {
            const isCompleted = task.status === 'completed';
            const initials = userName ? userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 'JB';
            
            if (isCompleted) {
                const item = document.createElement('div');
                item.className = 'task-item completed';
                item.innerHTML = `
                    <div class="task-item-left">
                        <input type="checkbox" checked onchange="toggleTask(${task.id}, 'active')" class="task-checkbox" />
                        <div>
                            <h4 class="task-title-text" style="text-decoration: line-through;">${escapeHtml(task.title)}</h4>
                            ${task.description ? `<p class="task-desc-text">${escapeHtml(task.description)}</p>` : ''}
                        </div>
                    </div>
                    <div class="task-item-right">
                        <span class="priority-badge badge-${task.priority.toLowerCase()}">${task.priority}</span>
                        <span class="task-date">${formatFriendlyDate(task.due_date)}</span>
                        <div class="task-avatar">${initials}</div>
                        <button onclick="deleteTask(${task.id})" class="delete-btn">Dzēst</button>
                    </div>
                `;
                completedTaskList.appendChild(item);
            } else {
                const item = document.createElement('div');
                item.className = 'task-item';
                item.innerHTML = `
                    <div class="task-item-left">
                        <input type="checkbox" onchange="toggleTask(${task.id}, 'completed')" class="task-checkbox" />
                        <div>
                            <h4 class="task-title-text">${escapeHtml(task.title)}</h4>
                            ${task.description ? `<p class="task-desc-text">${escapeHtml(task.description)}</p>` : ''}
                        </div>
                    </div>
                    <div class="task-item-right">
                        <span class="priority-badge badge-${task.priority.toLowerCase()}">${task.priority}</span>
                        <span class="task-date">${formatFriendlyDate(task.due_date)}</span>
                        <div class="task-avatar">${initials}</div>
                        <button onclick="deleteTask(${task.id})" class="delete-btn">Dzēst</button>
                    </div>
                `;
                taskList.appendChild(item);
            }
        });

        document.getElementById('count-active').textContent = allTasks.filter(t => t.status !== 'completed').length;
        document.getElementById('count-completed').textContent = completedCount;
        document.getElementById('count-high').textContent = allTasks.filter(t => t.status !== 'completed' && t.priority === 'High').length;
        document.getElementById('completed-header').textContent = `PABEIGTIE UZDEVUMI (${completedCount})`;
    }

    modalTaskForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('modal-title').value.trim();
        const description = document.getElementById('modal-description').value.trim();
        const priority = document.getElementById('modal-priority').value;

        if (!title || !finalDueDate) {
            alert('Lūdzu, ievadi nosaukumu un izvēlies termiņu (datumu un laiku)!');
            return;
        }

        try {
            const res = await fetch('/api/tasks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ title, description, priority, due_date: finalDueDate })
            });

            if (res.ok) {
                closeModal();
                loadTasks();
            } else {
                alert('Neizdevās izveidot uzdevumu.');
            }
        } catch (err) {
            console.error('Kļūda:', err);
        }
    });

    window.toggleTask = async function(id, newStatus) {
        try {
            await fetch(`/api/tasks/${id}/toggle`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ status: newStatus })
            });
            loadTasks();
        } catch (err) {
            console.error('Kļūda:', err);
        }
    };

    window.deleteTask = async function(id) {
        try {
            await fetch(`/api/tasks/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            loadTasks();
        } catch (err) {
            console.error('Kļūda:', err);
        }
    };

    function formatFriendlyDate(dateStr) {
        if (!dateStr || dateStr === 'Nenorādīts') return '';

        const cleanStr = dateStr.replace('T', ' ');
        const [datePart, timePart] = cleanStr.split(' ');
        if (!datePart) return dateStr;

        const [year, month, day] = datePart.split('-').map(Number);
        const targetDate = new Date(year, month - 1, day);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const targetDay = new Date(targetDate);
        targetDay.setHours(0, 0, 0, 0);

        const diffTime = targetDay - today;
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        const timeFormatted = timePart ? ` ${timePart.substring(0, 5)}` : '';

        if (diffDays === 0) {
            return `Šodien${timeFormatted}`;
        } else if (diffDays === 1) {
            return `Rīt${timeFormatted}`;
        } else if (diffDays === -1) {
            return `Vakar${timeFormatted}`;
        } else {
            const monthNames = [
                'Janvāris', 'Februāris', 'Marts', 'Aprīlis', 'Maijs', 'Jūnijs',
                'Jūlijs', 'Augusts', 'Septembris', 'Oktobris', 'Novembris', 'Decembris'
            ];
            const monthName = monthNames[month - 1];
            return `${day}. ${monthName}${timeFormatted}`;
        }
    }

    function escapeHtml(text) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.replace(/[&<>"']/g, function(m) { return map[m]; });
    }
});