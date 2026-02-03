import { getTasksFromCloud, saveTasksToCloud, subscribeToTasks, getContactsFromCloud, saveContactsToCloud } from './firebase.js';

document.addEventListener('DOMContentLoaded', () => {
    const editModal = document.getElementById('editModal');
    const editInput = document.getElementById('editInput');
    const contactFields = document.getElementById('contactFields');
    const editContactName = document.getElementById('editContactName');
    const editContactTask = document.getElementById('editContactTask');
    const timeSelector = document.getElementById('timeSelector');
    const timeBtns = document.querySelectorAll('.time-btn');
    const editConfirm = document.getElementById('editConfirm');
    const editDropZone = document.getElementById('editDropZone');

    // Page elements
    const sidebarBtns = document.querySelectorAll('.sidebar-btn');
    const pages = document.querySelectorAll('.page');

    // Invoer elements
    const transcriptInput = document.getElementById('transcriptInput');

    // Profiel elements
    const contactenTextarea = document.getElementById('contactenTextarea');

    let currentTask = null;
    let currentColumn = null;
    let isNewTask = false;
    let selectedTime = null;
    let isPlanningMode = false;

    // Drag state
    let isDragging = false;
    let draggedCard = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let cardOriginalRect = null;
    let placeholder = null;
    let dragRotation = 0;
    let holdTimeout = null;
    let mouseDownTime = 0;

    // Taken data (in-memory, synced met Firebase)
    let tasksData = {
        planning: [],
        bellen: [],
        mailen: []
    };

    // Contacten data
    let contacten = [];

    // ===================
    // PAGE NAVIGATION
    // ===================
    function switchPage(pageName) {
        sidebarBtns.forEach(btn => {
            if (btn.dataset.page === pageName) {
                btn.classList.add('sidebar-btn--active');
            } else {
                btn.classList.remove('sidebar-btn--active');
            }
        });

        pages.forEach(page => {
            if (page.id === 'page' + pageName.charAt(0).toUpperCase() + pageName.slice(1)) {
                page.classList.add('active');
            } else {
                page.classList.remove('active');
            }
        });
    }

    sidebarBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const pageName = btn.dataset.page;
            if (pageName) {
                switchPage(pageName);
            }
        });
    });

    // ===================
    // FIREBASE SYNC
    // ===================

    async function initializeData() {
        // Laad contacten
        contacten = await getContactsFromCloud();
        loadContactenToTextarea();

        // Subscribe naar taken updates (real-time sync)
        subscribeToTasks((data) => {
            tasksData = data;
            renderAllTasks();
        });
    }

    let isInitialLoad = true;

    function renderAllTasks() {
        const planningGrid = document.querySelector('.page--overzicht .column:nth-child(1) .tasks-grid');
        const bellenGrid = document.querySelector('.page--overzicht .column:nth-child(2) .tasks-grid');
        const mailenGrid = document.querySelector('.page--overzicht .column:nth-child(3) .tasks-grid');

        // Clear existing tasks (behalve icon en add button)
        [planningGrid, bellenGrid, mailenGrid].forEach(grid => {
            const cards = grid.querySelectorAll('.task-card:not(.task-card--icon):not(.task-card--add)');
            cards.forEach(card => card.remove());
        });

        let animationIndex = 0;
        const animateCard = (card) => {
            if (isInitialLoad) {
                card.classList.add('task-card--loading');
                const delay = animationIndex * 50; // 50ms tussen elke kaart
                animationIndex++;
                setTimeout(() => {
                    card.classList.remove('task-card--loading');
                    card.classList.add('task-card--loaded');
                }, delay + 10);
            }
        };

        // Render planning taken
        const planningAddBtn = planningGrid.querySelector('.task-card--add');
        tasksData.planning.forEach((task, index) => {
            const card = createPlanningCard(task, index);
            animateCard(card);
            planningGrid.insertBefore(card, planningAddBtn);
        });

        // Render bellen taken
        const bellenAddBtn = bellenGrid.querySelector('.task-card--add');
        tasksData.bellen.forEach((task, index) => {
            const card = createContactCard(task, index, 'bellen');
            animateCard(card);
            bellenGrid.insertBefore(card, bellenAddBtn);
        });

        // Render mailen taken
        const mailenAddBtn = mailenGrid.querySelector('.task-card--add');
        tasksData.mailen.forEach((task, index) => {
            const card = createContactCard(task, index, 'mailen');
            animateCard(card);
            mailenGrid.insertBefore(card, mailenAddBtn);
        });

        // Na eerste load, geen animatie meer
        if (isInitialLoad) {
            setTimeout(() => { isInitialLoad = false; }, 1000);
        }
    }

    function createPlanningCard(task, index) {
        const card = document.createElement('div');
        card.className = 'task-card task-card--planning';
        if (task.completed) card.classList.add('task-card--completed');
        card.dataset.index = index;
        card.dataset.category = 'planning';
        card.innerHTML = `
            <div class="task-content">
                <span class="task-title">${task.titel}</span>
                <span class="subtask-count">${task.uren || '.'}</span>
            </div>
        `;
        attachCardListeners(card);
        return card;
    }

    function createContactCard(task, index, category) {
        const card = document.createElement('div');
        card.className = 'task-card task-card--contact';
        if (task.completed) card.classList.add('task-card--completed');
        card.dataset.index = index;
        card.dataset.category = category;
        card.innerHTML = `
            <div class="task-content">
                <p><span class="contact-name">${task.naam}</span> <span class="task-description">${task.taak}</span></p>
            </div>
        `;
        attachCardListeners(card);
        return card;
    }

    async function saveAllTasks() {
        await saveTasksToCloud(tasksData);
    }

    // ===================
    // PROFIEL MANAGEMENT
    // ===================
    function loadContactenToTextarea() {
        if (contactenTextarea) {
            contactenTextarea.value = contacten.join(', ');
        }
    }

    async function saveContactenFromTextarea() {
        if (contactenTextarea) {
            const text = contactenTextarea.value;
            contacten = text.split(',')
                .map(name => name.trim())
                .filter(name => name.length > 0);
            await saveContactsToCloud(contacten);
        }
    }

    if (contactenTextarea) {
        contactenTextarea.addEventListener('blur', saveContactenFromTextarea);
    }

    // ===================
    // TRANSCRIPT PROCESSING
    // ===================

    async function parseTranscriptWithAI(transcript) {
        try {
            const response = await fetch('/api/parse-transcript', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    transcript: transcript,
                    contacten: contacten
                })
            });

            if (!response.ok) {
                throw new Error('API request failed');
            }

            return await response.json();
        } catch (error) {
            console.error('AI parsing failed, using fallback:', error);
            return parseTranscriptFallback(transcript);
        }
    }

    // Fallback parser als API niet beschikbaar is
    function parseTranscriptFallback(transcript) {
        const result = {
            planning: [],
            bellen: [],
            mailen: []
        };

        const lines = transcript.toLowerCase();

        if (lines.includes('bellen') || lines.includes('bel ')) {
            contacten.forEach(contact => {
                if (lines.includes(contact.toLowerCase())) {
                    result.bellen.push({
                        naam: contact,
                        taak: 'Opvolging gesprek',
                        completed: false
                    });
                }
            });
        }

        if (lines.includes('mail') || lines.includes('e-mail')) {
            contacten.forEach(contact => {
                if (lines.includes(contact.toLowerCase())) {
                    result.mailen.push({
                        naam: contact,
                        taak: 'E-mail sturen',
                        completed: false
                    });
                }
            });
        }

        const timeMatch = transcript.match(/(\d+)\s*(?:uur|u(?:ur)?)/gi);
        if (timeMatch) {
            const hours = parseInt(timeMatch[0]);
            const validHours = [1, 2, 3, 6].includes(hours) ? hours : 2;

            const sentences = transcript.split(/[.!?]/);
            sentences.forEach(sentence => {
                if (sentence.match(/\d+\s*(?:uur|u)/i)) {
                    const cleanTask = sentence.trim().substring(0, 50);
                    if (cleanTask.length > 5) {
                        result.planning.push({
                            titel: cleanTask,
                            uren: validHours,
                            completed: false
                        });
                    }
                }
            });
        }

        return result;
    }

    async function addTasksFromTranscript(tasks) {
        // Voeg completed: false toe aan alle taken
        const addCompleted = (arr) => arr.map(t => ({ ...t, completed: false }));

        tasksData.planning = [...tasksData.planning, ...addCompleted(tasks.planning || [])];
        tasksData.bellen = [...tasksData.bellen, ...addCompleted(tasks.bellen || [])];
        tasksData.mailen = [...tasksData.mailen, ...addCompleted(tasks.mailen || [])];

        await saveAllTasks();
    }

    if (transcriptInput) {
        transcriptInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                const transcript = transcriptInput.value.trim();
                if (!transcript) return;

                // Toon loading state
                transcriptInput.disabled = true;
                transcriptInput.placeholder = 'Analyseren...';

                try {
                    const tasks = await parseTranscriptWithAI(transcript);
                    await addTasksFromTranscript(tasks);
                    transcriptInput.value = '';
                    switchPage('overzicht');
                } catch (error) {
                    console.error('Error processing transcript:', error);
                    alert('Er ging iets mis bij het verwerken van het transcript.');
                } finally {
                    transcriptInput.disabled = false;
                    transcriptInput.placeholder = 'Plak hier je transcript of notities...';
                }
            }
        });
    }

    // ===================
    // DRAG & DROP
    // ===================
    function getRandomRotation() {
        return Math.random() * 20 - 12;
    }

    function startDrag(card, e) {
        if (isDragging) return;

        isDragging = true;
        draggedCard = card;
        cardOriginalRect = card.getBoundingClientRect();
        dragRotation = getRandomRotation();

        placeholder = document.createElement('div');
        placeholder.className = 'task-card-placeholder';
        card.parentNode.insertBefore(placeholder, card);

        card.classList.add('dragging');
        card.style.width = cardOriginalRect.width + 'px';
        card.style.height = cardOriginalRect.height + 'px';
        card.style.left = cardOriginalRect.left + 'px';
        card.style.top = cardOriginalRect.top + 'px';

        card.style.transform = `scale(1) rotate(0deg)`;
        card.offsetHeight;
        card.style.transform = `scale(1.1) rotate(${dragRotation}deg)`;

        positionDropZone();
        editDropZone.classList.add('visible');
        document.body.style.userSelect = 'none';
    }

    function positionDropZone() {
        const allCards = document.querySelectorAll('.page--overzicht .task-card:not(.dragging)');
        let lowestBottom = 0;

        allCards.forEach(card => {
            const rect = card.getBoundingClientRect();
            if (rect.bottom > lowestBottom) {
                lowestBottom = rect.bottom;
            }
        });

        const topPosition = lowestBottom + 32;
        const bottomPadding = 32;
        const availableHeight = window.innerHeight - topPosition - bottomPadding;

        editDropZone.style.top = topPosition + 'px';
        editDropZone.style.bottom = 'auto';
        editDropZone.style.height = Math.max(100, availableHeight) + 'px';
    }

    function updateDrag(e) {
        if (!isDragging || !draggedCard) return;

        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;

        draggedCard.style.left = (cardOriginalRect.left + deltaX) + 'px';
        draggedCard.style.top = (cardOriginalRect.top + deltaY) + 'px';

        const dropRect = editDropZone.getBoundingClientRect();
        const cardCenterX = e.clientX;
        const cardCenterY = e.clientY;

        if (cardCenterX >= dropRect.left && cardCenterX <= dropRect.right &&
            cardCenterY >= dropRect.top && cardCenterY <= dropRect.bottom) {
            editDropZone.classList.add('drag-over');
        } else {
            editDropZone.classList.remove('drag-over');
        }
    }

    function endDrag(e) {
        if (!isDragging || !draggedCard) return;

        const dropRect = editDropZone.getBoundingClientRect();
        const cardCenterX = e.clientX;
        const cardCenterY = e.clientY;

        const droppedInZone = cardCenterX >= dropRect.left && cardCenterX <= dropRect.right &&
                             cardCenterY >= dropRect.top && cardCenterY <= dropRect.bottom;

        if (droppedInZone) {
            const column = placeholder.closest('.column');
            const cardToEdit = draggedCard;
            resetCardPosition(true);
            draggedCard = null;
            openEditModal(cardToEdit, column, false);
        } else {
            snapBackCard();
        }

        editDropZone.classList.remove('visible', 'drag-over');
        document.body.style.userSelect = '';
    }

    function resetCardPosition(keepCardRef = false) {
        if (!draggedCard || !placeholder) return;

        draggedCard.classList.remove('dragging');
        draggedCard.style.width = '';
        draggedCard.style.height = '';
        draggedCard.style.left = '';
        draggedCard.style.top = '';
        draggedCard.style.transform = '';

        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.removeChild(placeholder);
        }

        isDragging = false;
        if (!keepCardRef) {
            draggedCard = null;
        }
        placeholder = null;
    }

    function snapBackCard() {
        if (!draggedCard || !placeholder) return;

        const card = draggedCard;
        const placeholderRect = placeholder.getBoundingClientRect();

        const targetLeft = placeholderRect.left;
        const targetTop = placeholderRect.top;

        const currentLeft = parseFloat(card.style.left);
        const currentTop = parseFloat(card.style.top);

        const deltaX = targetLeft - currentLeft;
        const deltaY = targetTop - currentTop;

        card.classList.add('snapping-back');
        card.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(1) rotate(0deg)`;

        setTimeout(() => {
            if (placeholder && placeholder.parentNode) {
                placeholder.parentNode.removeChild(placeholder);
            }
            placeholder = null;

            card.classList.remove('dragging', 'snapping-back');
            card.style.width = '';
            card.style.height = '';
            card.style.left = '';
            card.style.top = '';
            card.style.transform = '';

            isDragging = false;
            draggedCard = null;
        }, 350);
    }

    // ===================
    // EDIT MODAL
    // ===================
    function openEditModal(task, column, isNew = false) {
        currentTask = task;
        currentColumn = column;
        isNewTask = isNew;

        isPlanningMode = column.querySelector('.task-card--planning') !== null ||
                         column.querySelector('.task-card--icon img[alt="Plannen"]') !== null;

        // Check ook op basis van kolom positie
        const columns = document.querySelectorAll('.page--overzicht .column');
        const columnIndex = Array.from(columns).indexOf(column);
        if (columnIndex === 0) isPlanningMode = true;

        if (isPlanningMode) {
            editInput.classList.remove('hidden');
            editInput.style.display = '';
            contactFields.classList.add('hidden');
            timeSelector.classList.remove('hidden');
        } else {
            editInput.style.display = 'none';
            contactFields.classList.remove('hidden');
            timeSelector.classList.add('hidden');
        }

        if (isNew) {
            editInput.value = '';
            editContactName.value = '';
            editContactTask.value = '';
            selectedTime = null;
            timeBtns.forEach(btn => btn.classList.remove('selected'));
        } else {
            const category = task.dataset.category;
            const index = parseInt(task.dataset.index);

            if (isPlanningMode) {
                const taskData = tasksData.planning[index];
                if (taskData) {
                    editInput.value = taskData.titel;
                    selectedTime = taskData.uren ? String(taskData.uren) : null;
                    timeBtns.forEach(btn => {
                        if (selectedTime && btn.dataset.time === selectedTime) {
                            btn.classList.add('selected');
                        } else {
                            btn.classList.remove('selected');
                        }
                    });
                }
            } else {
                const taskData = tasksData[category][index];
                if (taskData) {
                    editContactName.value = taskData.naam;
                    editContactTask.value = taskData.taak;
                }
            }
        }

        editModal.classList.add('active');

        setTimeout(() => {
            if (isPlanningMode) {
                editInput.focus();
            } else {
                editContactName.focus();
            }
        }, 300);
    }

    function closeEditModal() {
        editModal.classList.remove('active');
        currentTask = null;
        currentColumn = null;
        isNewTask = false;
        selectedTime = null;
        isPlanningMode = false;
    }

    async function saveTask() {
        const columns = document.querySelectorAll('.page--overzicht .column');
        const columnIndex = Array.from(columns).indexOf(currentColumn);

        if (isPlanningMode) {
            const value = editInput.value.trim();
            if (!value) {
                closeEditModal();
                return;
            }

            if (isNewTask) {
                tasksData.planning.push({
                    titel: value,
                    uren: selectedTime ? parseInt(selectedTime) : null,
                    completed: false
                });
            } else {
                const index = parseInt(currentTask.dataset.index);
                tasksData.planning[index] = {
                    ...tasksData.planning[index],
                    titel: value,
                    uren: selectedTime ? parseInt(selectedTime) : null
                };
            }
        } else {
            const name = editContactName.value.trim();
            const task = editContactTask.value.trim();

            if (!name && !task) {
                closeEditModal();
                return;
            }

            const category = columnIndex === 1 ? 'bellen' : 'mailen';

            if (isNewTask) {
                tasksData[category].push({
                    naam: name,
                    taak: task,
                    completed: false
                });
            } else {
                const index = parseInt(currentTask.dataset.index);
                tasksData[category][index] = {
                    ...tasksData[category][index],
                    naam: name,
                    taak: task
                };
            }
        }

        await saveAllTasks();
        closeEditModal();
    }

    // ===================
    // CARD LISTENERS
    // ===================
    function attachCardListeners(card) {
        card.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();

            mouseDownTime = Date.now();
            dragStartX = e.clientX;
            dragStartY = e.clientY;

            holdTimeout = setTimeout(() => {
                startDrag(card, e);
            }, 100);
        });

        card.addEventListener('click', async (e) => {
            if (!isDragging && Date.now() - mouseDownTime < 250) {
                const category = card.dataset.category;
                const index = parseInt(card.dataset.index);

                if (tasksData[category] && tasksData[category][index]) {
                    tasksData[category][index].completed = !tasksData[category][index].completed;
                    await saveAllTasks();
                }
            }
        });
    }

    // ===================
    // GLOBAL EVENT LISTENERS
    // ===================
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            updateDrag(e);
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (holdTimeout) {
            clearTimeout(holdTimeout);
            holdTimeout = null;
        }

        if (isDragging) {
            endDrag(e);
        }
    });

    document.addEventListener('selectstart', (e) => {
        if (isDragging || holdTimeout) {
            e.preventDefault();
        }
    });

    timeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            timeBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedTime = btn.dataset.time;
        });
    });

    editConfirm.addEventListener('click', saveTask);

    editInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            saveTask();
        } else if (e.key === 'Escape') {
            closeEditModal();
        }
    });

    editContactName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            saveTask();
        } else if (e.key === 'Escape') {
            closeEditModal();
        }
    });

    editContactTask.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            saveTask();
        } else if (e.key === 'Escape') {
            closeEditModal();
        }
    });

    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) {
            closeEditModal();
        }
    });

    // Add button clicks
    document.querySelectorAll('.add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const column = btn.closest('.column');
            openEditModal(null, column, true);
        });
    });

    // Initialize Firebase data
    initializeData();
});
