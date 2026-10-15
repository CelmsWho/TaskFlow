document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    const userName = localStorage.getItem('userName') || 'Jānis Bērziņš';
    const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);

    document.querySelectorAll('#user-name-display, #drawer-user-name').forEach(el => { if (el) el.textContent = userName; });
    document.querySelectorAll('#user-avatar, #mobile-user-avatar, #drawer-user-avatar').forEach(el => { if (el) el.textContent = initials; });

    const handleLogout = () => {
        localStorage.clear();
        window.location.href = 'login.html';
    };

    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
    document.getElementById('drawer-logout-btn')?.addEventListener('click', handleLogout);

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const MONTHS = ['Jan','Feb','Mar','Apr','Mai','Jūn','Jūl','Aug','Sep','Okt','Nov','Dec'];
    const fmtDate = (d) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
        return m ? `${parseInt(m[3], 10)}. ${MONTHS[parseInt(m[2], 10) - 1]}` : esc(d || 'Šodien');
    };
    const todayISO = () => new Date().toISOString().slice(0, 10);

    let activeView = 'tasks';
    let currentProjectId = null;
    let projectsList = [];
    let currentFilter = 'All';
    let mobileActiveTab = 'todo';

    const pageTitle = document.getElementById('page-title');
    const pageSubtitle = document.getElementById('page-subtitle');
    const tasksViewContainer = document.getElementById('tasks-view-container');
    const kanbanViewContainer = document.getElementById('kanban-view-container');
    const invitationsViewContainer = document.getElementById('invitations-view-container');
    const teamAvatarsContainer = document.getElementById('team-avatars-container');
    const kanbanStatusGroup = document.getElementById('kanban-status-group');
    const newProjectBtn = document.getElementById('new-project-btn');
    const inviteBtn = document.getElementById('invite-btn');
    const editProjectBtn = document.getElementById('edit-project-btn');
    const deleteProjectBtn = document.getElementById('delete-project-btn');
    const leaveProjectBtn = document.getElementById('leave-project-btn');
    const projectBtns = [editProjectBtn, deleteProjectBtn, leaveProjectBtn];
    let tasksCache = [], kanbanCache = [], editing = null, editingProjectId = null;
    const myId = (() => { try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).id; } catch { return null; } })();
    const api = (url, method, body) => fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined
    });
    const showErr = async (r, fallback) => { const d = await r.json().catch(() => ({})); alert((d.error || fallback) + (d.detail ? '\n' + d.detail : '')); };
    const AVATAR_COLORS = ['#6366F1', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899', '#06B6D4'];
    const initialsOf = (name) => String(name || '?').trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().substring(0, 2);

    async function loadMembers(projectId) {
        try {
            const res = await fetch(`/api/projects/${projectId}/members`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) return;
            const members = await res.json();
            const box = document.getElementById('team-avatars');
            box.innerHTML = members.map((m, i) =>
                `<div class="task-avatar" title="${esc(m.name)}" style="background-color: ${AVATAR_COLORS[m.id % AVATAR_COLORS.length]}; border: 2px solid #0F172A; ${i ? 'margin-left: -8px;' : ''}">${esc(initialsOf(m.name))}</div>`
            ).join('');
        } catch (err) { console.error(err); }
    }

    inviteBtn.addEventListener('click', async () => {
        if (!currentProjectId) return;
        const email = prompt('Ievadi lietotāja e-pastu, ko uzaicināt projektā:');
        if (!email) return;
        const res = await fetch(`/api/projects/${currentProjectId}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ email })
        });
        const d = await res.json().catch(() => ({}));
        alert(res.ok ? 'Uzaicinājums nosūtīts!' : (d.error || 'Neizdevās nosūtīt uzaicinājumu'));
    });

    async function loadInvitationsBadge() {
        try {
            const res = await fetch('/api/invitations', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            const count = data.length;
            document.querySelectorAll('#sidebar-badge, #mobile-badge').forEach(b => {
                b.textContent = count;
                b.style.display = count > 0 ? 'flex' : 'none';
            });
            const bottomBadge = document.getElementById('bottom-nav-badge');
            if (bottomBadge) bottomBadge.style.display = count > 0 ? 'block' : 'none';
        } catch (err) { console.error(err); }
    }

    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = item.getAttribute('data-view') || (item.textContent.includes('Projekti') ? 'projects' : (item.textContent.includes('Uzaicinājumi') ? 'invitations' : 'tasks'));
            
            document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(i => i.classList.remove('active'));
            document.querySelectorAll(`[data-view="${view}"]`).forEach(i => i.classList.add('active'));

            setActiveView(view);
            document.getElementById('mobile-menu-drawer')?.classList.add('hidden');
        });
    });

    function setActiveView(view) {
        activeView = view;
        tasksViewContainer.classList.add('hidden');
        kanbanViewContainer.classList.add('hidden');
        invitationsViewContainer.classList.add('hidden');
        teamAvatarsContainer.style.display = 'none';
        pageSubtitle.style.display = 'none';
        kanbanStatusGroup.style.display = 'none';
        newProjectBtn.style.display = 'none';
        inviteBtn.style.display = 'none';
        projectBtns.forEach(b => b.style.display = 'none');

        if (view === 'tasks') {
            pageTitle.textContent = 'Mani Uzdevumi';
            tasksViewContainer.classList.remove('hidden');
            loadTasks();
        } else if (view === 'projects') {
            kanbanViewContainer.classList.remove('hidden');
            teamAvatarsContainer.style.display = 'flex';
            kanbanStatusGroup.style.display = 'block';
            newProjectBtn.style.display = 'inline-flex';
            inviteBtn.style.display = 'inline-flex';
            loadProjects();
        } else if (view === 'invitations') {
            pageTitle.textContent = 'Uzaicinājumi';
            invitationsViewContainer.classList.remove('hidden');
            loadInvitationsView();
        }
    }

    async function loadTasks() {
        if (activeView !== 'tasks') return;
        try {
            const res = await fetch('/api/tasks', { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const tasks = await res.json();
                renderTasks(tasks);
            }
        } catch (err) { console.error(err); }
    }

    function renderTasks(tasks) {
        const taskListEl = document.getElementById('task-list');
        const completedTaskListEl = document.getElementById('completed-task-list');
        if (!taskListEl) return;
        tasksCache = tasks;
        taskListEl.innerHTML = '';
        completedTaskListEl.innerHTML = '';

        let activeCount = 0, completedCount = 0, highCount = 0;

        tasks.forEach(task => {
            const isCompleted = task.completed === 1 || task.completed === true;
            if (!isCompleted) { activeCount++; if (task.priority === 'High') highCount++; }
            else { completedCount++; }

            if (currentFilter !== 'All' && task.priority !== currentFilter && !isCompleted) return;

            const item = document.createElement('div');
            item.className = `task-item ${isCompleted ? 'completed' : ''}`;
            item.innerHTML = `
                <div class="task-item-left">
                    <input type="checkbox" class="task-checkbox" ${isCompleted ? 'checked' : ''} data-id="${task.id}" />
                    <div>
                        <p class="task-title-text">${esc(task.title)}</p>
                        <p class="task-desc-text">${esc(task.description)}</p>
                    </div>
                </div>
                <div class="task-item-right">
                    <span class="priority-badge badge-${esc(task.priority.toLowerCase())}">${esc(task.priority)}</span>
                    <span class="task-date">${fmtDate(task.task_date)}</span>
                    <div class="task-avatar">${initials}</div>
                    <button class="edit-btn" data-kind="task" data-id="${task.id}">Labot</button>
                    <button class="delete-btn" data-id="${task.id}">Dzēst</button>
                </div>
            `;
            if (isCompleted) completedTaskListEl.appendChild(item);
            else taskListEl.appendChild(item);
        });

        document.getElementById('count-active').textContent = activeCount;
        document.getElementById('count-completed').textContent = completedCount;
        document.getElementById('count-high').textContent = highCount;
        document.getElementById('completed-header').textContent = `PABEIGTIE UZDEVUMI (${completedCount})`;
    }

    async function loadProjects() {
        try {
            const res = await fetch('/api/projects', { headers: { 'Authorization': `Bearer ${token}` } });
            projectsList = await res.json();
            
            const sidebarList = document.getElementById('sidebar-projects-list');
            sidebarList.innerHTML = '';

            projectsList.forEach((proj, idx) => {
                if (!currentProjectId && idx === 0) currentProjectId = proj.id;
                const div = document.createElement('a');
                div.className = `project-item ${currentProjectId === proj.id ? 'active' : ''}`;
                div.innerHTML = `<span class="dot-green"></span> ${esc(proj.title)}`;
                div.addEventListener('click', () => {
                    currentProjectId = proj.id;
                    if (activeView !== 'projects') document.querySelector('.nav-item[data-view="projects"]').click();
                    else loadProjects();
                });
                sidebarList.appendChild(div);
            });

            if (activeView !== 'projects') return;
            if (projectsList.length > 0) {
                const activeProj = projectsList.find(p => p.id === currentProjectId) || projectsList[0];
                pageTitle.textContent = activeProj.title;
                pageSubtitle.textContent = activeProj.description || '';
                pageSubtitle.style.display = 'block';
                loadKanbanTasks(activeProj.id);
                loadMembers(activeProj.id);
                const isOwner = activeProj.owner_id === myId;
                editProjectBtn.style.display = deleteProjectBtn.style.display = isOwner ? 'inline-flex' : 'none';
                leaveProjectBtn.style.display = isOwner ? 'none' : 'inline-flex';
                loadInvitationBanner();
            } else {
                pageTitle.textContent = 'Nav projektu';
                teamAvatarsContainer.style.display = 'none';
                inviteBtn.style.display = 'none';
                projectBtns.forEach(b => b.style.display = 'none');
                pageSubtitle.textContent = 'Izveido pirmo projektu ar pogu "+ Jauns projekts".';
                pageSubtitle.style.display = 'block';
                ['kanban-todo-list', 'kanban-inprogress-list', 'kanban-done-list'].forEach(id => document.getElementById(id).innerHTML = '');
            }
        } catch (err) { console.error(err); }
    }

    async function loadKanbanTasks(projectId) {
        try {
            const res = await fetch(`/api/projects/${projectId}/tasks`, { headers: { 'Authorization': `Bearer ${token}` } });
            const tasks = await res.json();
            kanbanCache = tasks;

            const todoList = document.getElementById('kanban-todo-list');
            const inProgressList = document.getElementById('kanban-inprogress-list');
            const doneList = document.getElementById('kanban-done-list');

            todoList.innerHTML = '';
            inProgressList.innerHTML = '';
            doneList.innerHTML = '';

            let todoC = 0, inprogC = 0, doneC = 0;

            tasks.forEach(task => {
                const card = document.createElement('div');
                card.className = 'kanban-card';
                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span class="priority-badge badge-${esc(task.priority.toLowerCase())}">${esc(task.priority)}</span>
                        <select onchange="changeTaskStatus(${task.id}, this.value)" style="background: #0F172A; color: #94A3B8; border: 1px solid #334155; border-radius: 6px; padding: 2px 6px; font-size: 11px; cursor: pointer;">
                            <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>To Do</option>
                            <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                            <option value="done" ${task.status === 'done' ? 'selected' : ''}>Done</option>
                        </select>
                    </div>
                    <p class="kanban-card-title" ${task.status === 'done' ? 'style="text-decoration:line-through;color:#64748B;"' : ''}>${esc(task.title)}</p>
                    <p class="kanban-card-desc">${esc(task.description)}</p>
                    <div class="kanban-card-footer">
                        <span>Termiņš: ${fmtDate(task.task_date)}</span>
                        <span>${esc(task.assignee || initials)}</span>
                    </div>
                    <div style="display: flex; gap: 14px; margin-top: 10px; padding-top: 8px; border-top: 1px solid #334155;">
                        <button class="edit-btn" data-kind="ptask" data-id="${task.id}">Labot</button>
                        <button class="del-ptask-btn" data-id="${task.id}">Dzēst</button>
                    </div>
                `;

                if (task.status === 'todo') { todoC++; todoList.appendChild(card); }
                else if (task.status === 'in_progress') { inprogC++; inProgressList.appendChild(card); }
                else { doneC++; doneList.appendChild(card); }
            });

            document.getElementById('todo-count').textContent = todoC;
            document.getElementById('inprogress-count').textContent = inprogC;
            document.getElementById('done-count').textContent = doneC;
            document.getElementById('tab-todo-count').textContent = todoC;
            document.getElementById('tab-inprog-count').textContent = inprogC;
            document.getElementById('tab-done-count').textContent = doneC;

            updateMobileKanbanView();
        } catch (err) { console.error(err); }
    }

    window.changeTaskStatus = async function(taskId, newStatus) {
        try {
            await fetch(`/api/project-tasks/${taskId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ status: newStatus })
            });
            if (currentProjectId) {
                loadKanbanTasks(currentProjectId);
            }
        } catch (err) { console.error('Kļūda mainot statusu:', err); }
    };

    async function loadInvitationBanner() {
        try {
            const res = await fetch('/api/invitations', { headers: { 'Authorization': `Bearer ${token}` } });
            const invs = await res.json();
            const bannerArea = document.getElementById('invitation-banner-area');
            bannerArea.innerHTML = '';

            if (invs.length > 0) {
                const inv = invs[0];
                bannerArea.innerHTML = `
                    <div class="invitation-banner">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 32px; height: 32px; background: rgba(99,102,241,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #6366F1;">✓</div>
                            <span style="font-size: 13px; color: #F8FAFC;"><b>${esc(inv.sender)}</b> aicina jūs pievienoties projektam <b>"${esc(inv.project_name)}"</b></span>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn-primary" style="padding: 6px 14px; font-size: 12px; background: #10B981;" onclick="respondInvitation(${inv.id}, 'accepted')">Pieņemt</button>
                            <button class="btn-secondary" style="padding: 6px 14px; font-size: 12px;" onclick="respondInvitation(${inv.id}, 'rejected')">Noraidīt</button>
                        </div>
                    </div>
                `;
            }
        } catch (err) { console.error(err); }
    }

    window.respondInvitation = async function(id, status) {
        await fetch(`/api/invitations/${id}/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ status })
        });
        loadProjects();
        loadInvitationsBadge();
        loadInvitationsView();
    };

    async function loadInvitationsView() {
        try {
            const res = await fetch('/api/invitations', { headers: { 'Authorization': `Bearer ${token}` } });
            const invs = await res.json();
            const list = document.getElementById('invitations-list');
            list.innerHTML = '';

            if (invs.length === 0) {
                list.innerHTML = '<p style="color: #94A3B8;">Pašlaik nav jaunu uzaicinājumu.</p>';
                return;
            }

            invs.forEach(inv => {
                const card = document.createElement('div');
                card.className = 'task-item';
                card.innerHTML = `
                    <div>
                        <p class="task-title-text">Uzaicinājums uz projektu: "${esc(inv.project_name)}"</p>
                        <p class="task-desc-text">Nosūtīja: ${esc(inv.sender)}</p>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn-primary" style="padding: 6px 14px; font-size: 12px; background: #10B981;" onclick="respondInvitation(${inv.id}, 'accepted')">Pieņemt</button>
                        <button class="btn-secondary" style="padding: 6px 14px; font-size: 12px;" onclick="respondInvitation(${inv.id}, 'rejected')">Noraidīt</button>
                    </div>
                `;
                list.appendChild(card);
            });
        } catch (err) { console.error(err); }
    }

    document.querySelectorAll('.kanban-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.kanban-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            mobileActiveTab = btn.getAttribute('data-tab');
            updateMobileKanbanView();
        });
    });

    function updateMobileKanbanView() {
        if (window.innerWidth <= 768) {
            ['todo', 'in_progress', 'done'].forEach(tab => {
                const col = document.getElementById(`col-${tab}`);
                if (col) {
                    if (tab === mobileActiveTab) col.style.display = 'flex';
                    else col.style.display = 'none';
                }
            });
        } else {
            ['todo', 'in_progress', 'done'].forEach(tab => {
                const col = document.getElementById(`col-${tab}`);
                if (col) col.style.display = 'flex';
            });
        }
    }

    document.addEventListener('change', async (e) => {
        if (e.target.classList.contains('task-checkbox')) {
            const id = e.target.getAttribute('data-id');
            const completed = e.target.checked;
            await fetch(`/api/tasks/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ completed })
            });
            loadTasks();
        }
    });

    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-btn')) {
            if (!confirm('Dzēst šo uzdevumu?')) return;
            const id = e.target.getAttribute('data-id');
            await fetch(`/api/tasks/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            loadTasks();
        }
    });

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.getAttribute('data-filter');
            loadTasks();
        });
    });

    const modal = document.getElementById('task-modal');
    document.querySelectorAll('#open-modal-btn, #mobile-open-modal-btn').forEach(b => b.addEventListener('click', () => { setTaskModalMode(null); document.getElementById('modal-date').value = todayISO(); modal.classList.remove('hidden'); }));
    document.getElementById('cancel-modal-btn')?.addEventListener('click', () => modal.classList.add('hidden'));
    document.getElementById('modal-drag-handle')?.addEventListener('click', () => modal.classList.add('hidden'));

    const projModal = document.getElementById('project-modal');
    document.querySelectorAll('#open-project-modal-btn, #new-project-btn').forEach(b => b.addEventListener('click', () => { setProjectModalMode(null); projModal.classList.remove('hidden'); }));
    document.getElementById('cancel-proj-modal-btn')?.addEventListener('click', () => projModal.classList.add('hidden'));
    document.getElementById('modal-proj-drag-handle')?.addEventListener('click', () => projModal.classList.add('hidden'));

    const priorityButtons = document.querySelectorAll('.priority-option');
    const priorityInput = document.getElementById('modal-priority');
    priorityButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            priorityButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (priorityInput) priorityInput.value = btn.getAttribute('data-priority');
        });
    });

    document.getElementById('modal-task-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('modal-title').value;
        const description = document.getElementById('modal-description').value;
        const priority = priorityInput ? priorityInput.value : 'Medium';
        const task_date = document.getElementById('modal-date').value || todayISO();

        if (editing) {
            const body = { title, description, priority, task_date };
            const kind = editing.kind;
            let url = `/api/tasks/${editing.id}`;
            if (kind === 'ptask') {
                url = `/api/project-tasks/${editing.id}`;
                body.status = document.getElementById('modal-kanban-status').value;
            }
            const r = await api(url, 'PUT', body);
            if (!r.ok) { await showErr(r, 'Neizdevās saglabāt uzdevumu'); return; }
            setTaskModalMode(null);
            modal.classList.add('hidden');
            if (kind === 'task') loadTasks(); else loadKanbanTasks(currentProjectId);
            return;
        }

        if (activeView === 'tasks') {
            await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ title, description, priority, task_date })
            });
            loadTasks();
        } else if (activeView === 'projects' && currentProjectId) {
            const status = document.getElementById('modal-kanban-status').value;
            const tr = await fetch(`/api/projects/${currentProjectId}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ title, description, priority, status, task_date, assignee: initials })
            });
            if (!tr.ok) {
                const d = await tr.json().catch(() => ({}));
                alert((d.error || 'Neizdevās pievienot uzdevumu') + (d.detail ? '\n' + d.detail : ''));
                return;
            }
            loadKanbanTasks(currentProjectId);
        } else if (activeView === 'projects') {
            alert('Vispirms izveido projektu ar pogu "+ Jauns projekts".');
            return;
        }

        e.target.reset();
        priorityButtons.forEach(b => b.classList.toggle('active', b.dataset.priority === 'Medium'));
        modal.classList.add('hidden');
    });

    document.getElementById('modal-project-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('modal-proj-title').value;
        const description = document.getElementById('modal-proj-desc').value;

        if (editingProjectId) {
            const r = await api(`/api/projects/${editingProjectId}`, 'PUT', { title, description });
            if (!r.ok) { await showErr(r, 'Neizdevās saglabāt projektu'); return; }
            setProjectModalMode(null);
            projModal.classList.add('hidden');
            loadProjects();
            return;
        }

        const res = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ title, description })
        });
        if (res.ok) {
            const data = await res.json();
            currentProjectId = data.id;
            projModal.classList.add('hidden');
            e.target.reset();
            if (activeView !== 'projects') document.querySelector('.nav-item[data-view="projects"]').click();
            else loadProjects();
        } else {
            const d = await res.json().catch(() => ({}));
            alert((d.error || 'Neizdevās izveidot projektu') + (d.detail ? '\n' + d.detail : ''));
        }
    });

    document.getElementById('hamburger-btn')?.addEventListener('click', () => document.getElementById('mobile-menu-drawer')?.classList.remove('hidden'));
    document.getElementById('close-drawer-btn')?.addEventListener('click', () => document.getElementById('mobile-menu-drawer')?.classList.add('hidden'));

    document.querySelectorAll('.modal-overlay').forEach(ov => {
        ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.add('hidden'); });
        ov.querySelector('.modal-close-btn')?.addEventListener('click', () => ov.classList.add('hidden'));
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') document.querySelectorAll('.modal-overlay').forEach(ov => ov.classList.add('hidden'));
    });

    function setTaskModalMode(task, kind) {
        const form = document.getElementById('modal-task-form');
        form.reset();
        editing = task ? { kind, id: task.id } : null;
        document.querySelector('#task-modal h2').textContent = task ? 'Labot uzdevumu' : 'Izveidot jaunu uzdevumu';
        form.querySelector('button[type="submit"]').textContent = task ? 'Saglabāt' : 'Izveidot';
        const prio = task ? task.priority : 'Medium';
        priorityButtons.forEach(b => b.classList.toggle('active', b.dataset.priority === prio));
        if (priorityInput) priorityInput.value = prio;
        if (task) {
            document.getElementById('modal-title').value = task.title || '';
            document.getElementById('modal-description').value = task.description || '';
            document.getElementById('modal-date').value = /^\d{4}-\d{2}-\d{2}$/.test(task.task_date || '') ? task.task_date : todayISO();
            if (kind === 'ptask') document.getElementById('modal-kanban-status').value = task.status;
        }
    }

    function setProjectModalMode(proj) {
        const form = document.getElementById('modal-project-form');
        form.reset();
        editingProjectId = proj ? proj.id : null;
        document.querySelector('#project-modal h2').textContent = proj ? 'Labot projektu' : 'Izveidot projektu';
        form.querySelector('button[type="submit"]').textContent = proj ? 'Saglabāt' : 'Izveidot';
        if (proj) {
            document.getElementById('modal-proj-title').value = proj.title || '';
            document.getElementById('modal-proj-desc').value = proj.description || '';
        }
    }

    document.addEventListener('click', async (e) => {
        const editBtn = e.target.closest('.edit-btn');
        if (editBtn) {
            const kind = editBtn.dataset.kind;
            const list = kind === 'task' ? tasksCache : kanbanCache;
            const task = list.find(t => String(t.id) === editBtn.dataset.id);
            if (!task) return;
            setTaskModalMode(task, kind);
            modal.classList.remove('hidden');
            return;
        }
        const delBtn = e.target.closest('.del-ptask-btn');
        if (delBtn) {
            if (!confirm('Dzēst šo uzdevumu?')) return;
            const r = await api(`/api/project-tasks/${delBtn.dataset.id}`, 'DELETE');
            if (!r.ok) return showErr(r, 'Neizdevās dzēst uzdevumu');
            loadKanbanTasks(currentProjectId);
        }
    });

    const currentProject = () => projectsList.find(p => p.id === currentProjectId);

    editProjectBtn.addEventListener('click', () => {
        const p = currentProject();
        if (!p) return;
        setProjectModalMode(p);
        projModal.classList.remove('hidden');
    });

    deleteProjectBtn.addEventListener('click', async () => {
        const p = currentProject();
        if (!p || !confirm(`Dzēst projektu "${p.title}" un visus tā uzdevumus? Tas pazudīs visiem dalībniekiem.`)) return;
        const r = await api(`/api/projects/${p.id}`, 'DELETE');
        if (!r.ok) return showErr(r, 'Neizdevās dzēst projektu');
        currentProjectId = null;
        loadProjects();
    });

    leaveProjectBtn.addEventListener('click', async () => {
        const p = currentProject();
        if (!p || !confirm(`Atteikties no projekta "${p.title}"? Tu vairs to neredzēsi.`)) return;
        const r = await api(`/api/projects/${p.id}/leave`, 'POST');
        if (!r.ok) return showErr(r, 'Neizdevās atteikties no projekta');
        currentProjectId = null;
        loadProjects();
    });

    loadTasks();
    loadProjects(); // aizpilda sānjoslas projektu sarakstu
    loadInvitationsBadge();
});