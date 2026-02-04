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

    // Drag state
    let isDragging = false;
    let draggedCard = null;
    let draggedTaskData = null;
    let draggedFromCategory = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let cardOriginalRect = null;
    let placeholder = null;
    let dragRotation = 0;
    let holdTimeout = null;
    let mouseDownTime = 0;
    let hoveredColumn = null;

    // Taken data (in-memory, synced met Firebase)
    let tasksData = {
        inbox: [],
        planning: [],
        bellen: [],
        mailen: []
    };

    // Vorige staat voor detectie van nieuwe taken
    let previousTaskCounts = {
        inbox: 0,
        planning: 0,
        bellen: 0,
        mailen: 0
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
            // Voeg inbox toe als die niet bestaat
            if (!data.inbox) data.inbox = [];
            tasksData = data;

            // Verwijder taken die langer dan 24 uur geleden zijn afgevinkt
            cleanupOldCompletedTasks();

            renderAllTasks();
        });
    }

    // ===================
    // AUTO-CLEANUP COMPLETED TASKS
    // ===================
    async function cleanupOldCompletedTasks() {
        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;
        let hasChanges = false;

        ['inbox', 'planning', 'bellen', 'mailen'].forEach(category => {
            if (!tasksData[category]) return;

            const originalLength = tasksData[category].length;
            tasksData[category] = tasksData[category].filter(task => {
                if (task.completed && task.completedAt) {
                    const completedTime = new Date(task.completedAt).getTime();
                    return (now - completedTime) < ONE_DAY;
                }
                return true;
            });

            if (tasksData[category].length !== originalLength) {
                hasChanges = true;
            }
        });

        if (hasChanges) {
            await saveAllTasks();
        }
    }

    let isInitialLoad = true;
    let initialAnimationDone = false;

    function animateInitialCards() {
        if (initialAnimationDone) return;
        initialAnimationDone = true;

        const allStaticCards = document.querySelectorAll('.page--overzicht .task-card--icon, .page--overzicht .task-card--add');
        allStaticCards.forEach(card => {
            card.classList.add('task-card--loading');
        });

        setTimeout(() => {
            let index = 0;
            allStaticCards.forEach(card => {
                const delay = index * 50;
                index++;
                setTimeout(() => {
                    card.classList.remove('task-card--loading');
                    card.classList.add('task-card--loaded');
                }, delay);
            });
        }, 10);
    }

    function renderAllTasks() {
        const inboxGrid = document.querySelector('.page--overzicht .column[data-category="inbox"] .tasks-grid');
        const planningGrid = document.querySelector('.page--overzicht .column[data-category="planning"] .tasks-grid');
        const bellenGrid = document.querySelector('.page--overzicht .column[data-category="bellen"] .tasks-grid');
        const mailenGrid = document.querySelector('.page--overzicht .column[data-category="mailen"] .tasks-grid');

        // Detecteer nieuwe taken
        const newTaskIndices = {
            inbox: tasksData.inbox && tasksData.inbox.length > previousTaskCounts.inbox
                ? Array.from({ length: tasksData.inbox.length - previousTaskCounts.inbox }, (_, i) => previousTaskCounts.inbox + i)
                : [],
            planning: tasksData.planning && tasksData.planning.length > previousTaskCounts.planning
                ? Array.from({ length: tasksData.planning.length - previousTaskCounts.planning }, (_, i) => previousTaskCounts.planning + i)
                : [],
            bellen: tasksData.bellen && tasksData.bellen.length > previousTaskCounts.bellen
                ? Array.from({ length: tasksData.bellen.length - previousTaskCounts.bellen }, (_, i) => previousTaskCounts.bellen + i)
                : [],
            mailen: tasksData.mailen && tasksData.mailen.length > previousTaskCounts.mailen
                ? Array.from({ length: tasksData.mailen.length - previousTaskCounts.mailen }, (_, i) => previousTaskCounts.mailen + i)
                : []
        };

        // Clear existing tasks (behalve icon en add button)
        [inboxGrid, planningGrid, bellenGrid, mailenGrid].forEach(grid => {
            if (!grid) return;
            const cards = grid.querySelectorAll('.task-card:not(.task-card--icon):not(.task-card--add)');
            cards.forEach(card => card.remove());
        });

        if (isInitialLoad) {
            animateInitialCards();
        }

        const staticCardsCount = document.querySelectorAll('.page--overzicht .task-card--icon, .page--overzicht .task-card--add').length;

        let animationIndex = 0;
        const animateCard = (card, isNew = false) => {
            if (isInitialLoad) {
                card.classList.add('task-card--loading');
                const delay = (staticCardsCount + animationIndex) * 50;
                animationIndex++;
                setTimeout(() => {
                    card.classList.remove('task-card--loading');
                    card.classList.add('task-card--loaded');
                }, delay + 10);
            } else if (isNew) {
                card.classList.add('task-card--loading');
                setTimeout(() => {
                    card.classList.remove('task-card--loading');
                    card.classList.add('task-card--loaded');
                }, 10);
            }
        };

        // Render inbox taken
        if (inboxGrid && tasksData.inbox) {
            const inboxAddBtn = inboxGrid.querySelector('.task-card--add');
            tasksData.inbox.forEach((task, index) => {
                const card = createInboxCard(task, index);
                const isNew = newTaskIndices.inbox.includes(index);
                animateCard(card, isNew);
                inboxGrid.insertBefore(card, inboxAddBtn);
            });
        }

        // Render planning taken
        if (planningGrid && tasksData.planning) {
            const planningAddBtn = planningGrid.querySelector('.task-card--add');
            tasksData.planning.forEach((task, index) => {
                const card = createPlanningCard(task, index);
                const isNew = newTaskIndices.planning.includes(index);
                animateCard(card, isNew);
                planningGrid.insertBefore(card, planningAddBtn);
            });
        }

        // Render bellen taken
        if (bellenGrid && tasksData.bellen) {
            const bellenAddBtn = bellenGrid.querySelector('.task-card--add');
            tasksData.bellen.forEach((task, index) => {
                const card = createContactCard(task, index, 'bellen');
                const isNew = newTaskIndices.bellen.includes(index);
                animateCard(card, isNew);
                bellenGrid.insertBefore(card, bellenAddBtn);
            });
        }

        // Render mailen taken
        if (mailenGrid && tasksData.mailen) {
            const mailenAddBtn = mailenGrid.querySelector('.task-card--add');
            tasksData.mailen.forEach((task, index) => {
                const card = createContactCard(task, index, 'mailen');
                const isNew = newTaskIndices.mailen.includes(index);
                animateCard(card, isNew);
                mailenGrid.insertBefore(card, mailenAddBtn);
            });
        }

        // Update previous counts
        previousTaskCounts = {
            inbox: tasksData.inbox ? tasksData.inbox.length : 0,
            planning: tasksData.planning ? tasksData.planning.length : 0,
            bellen: tasksData.bellen ? tasksData.bellen.length : 0,
            mailen: tasksData.mailen ? tasksData.mailen.length : 0
        };

        if (isInitialLoad) {
            setTimeout(() => { isInitialLoad = false; }, 2000);
        }
    }

    function createInboxCard(task, index) {
        const card = document.createElement('div');
        card.className = 'task-card task-card--inbox';
        if (task.completed) card.classList.add('task-card--completed');
        card.dataset.index = index;
        card.dataset.category = 'inbox';
        card.innerHTML = `
            <div class="task-content">
                <span class="task-title">${task.titel}</span>
            </div>
        `;
        attachCardListeners(card);
        return card;
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
        const addCompleted = (arr) => arr.map(t => ({ ...t, completed: false }));

        tasksData.planning = [...(tasksData.planning || []), ...addCompleted(tasks.planning || [])];
        tasksData.bellen = [...(tasksData.bellen || []), ...addCompleted(tasks.bellen || [])];
        tasksData.mailen = [...(tasksData.mailen || []), ...addCompleted(tasks.mailen || [])];

        await saveAllTasks();
    }

    if (transcriptInput) {
        transcriptInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                const transcript = transcriptInput.value.trim();
                if (!transcript) return;

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

    function getColumnAtPosition(x, y) {
        const columns = document.querySelectorAll('.page--overzicht .column');
        for (const column of columns) {
            const rect = column.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return column;
            }
        }
        return null;
    }

    function startDrag(card, e) {
        if (isDragging) return;

        isDragging = true;
        draggedCard = card;
        cardOriginalRect = card.getBoundingClientRect();
        dragRotation = getRandomRotation();

        // Bewaar task data voor het verplaatsen
        const category = card.dataset.category;
        const index = parseInt(card.dataset.index);
        draggedTaskData = { ...tasksData[category][index] };
        draggedFromCategory = category;

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

        // Highlight alle kolommen als mogelijke drop targets
        document.querySelectorAll('.page--overzicht .column').forEach(col => {
            col.classList.add('drop-target');
        });

        document.body.classList.add('is-dragging');
        document.body.style.userSelect = 'none';
    }

    let ghostCard = null;

    function createGhostCard(targetCategory) {
        if (!draggedTaskData) return null;

        const ghost = document.createElement('div');
        ghost.className = 'task-card task-card-ghost';

        // Converteer data naar target format en maak content
        if (targetCategory === 'inbox' || targetCategory === 'planning') {
            ghost.classList.add('task-card--planning');
            const titel = draggedTaskData.titel || draggedTaskData.naam || 'Taak';
            ghost.innerHTML = `
                <div class="task-content">
                    <span class="task-title">${titel}</span>
                    ${targetCategory === 'planning' && draggedTaskData.uren ? `<span class="task-hours">${draggedTaskData.uren}</span>` : ''}
                </div>
            `;
        } else {
            // bellen of mailen
            ghost.classList.add('task-card--contact');
            const naam = draggedTaskData.naam || draggedTaskData.titel || 'Contact';
            const taak = draggedTaskData.taak || '';
            ghost.innerHTML = `
                <div class="task-content">
                    <span class="task-name">${naam}</span>
                    <span class="task-description">${taak}</span>
                </div>
            `;
        }

        return ghost;
    }

    function removeGhostCard() {
        if (ghostCard) {
            ghostCard.remove();
            ghostCard = null;
        }
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

        // Check edit drop zone
        const dropRect = editDropZone.getBoundingClientRect();
        const cardCenterX = e.clientX;
        const cardCenterY = e.clientY;

        if (cardCenterX >= dropRect.left && cardCenterX <= dropRect.right &&
            cardCenterY >= dropRect.top && cardCenterY <= dropRect.bottom) {
            editDropZone.classList.add('drag-over');
        } else {
            editDropZone.classList.remove('drag-over');
        }

        // Highlight hovered column and show ghost preview
        const column = getColumnAtPosition(e.clientX, e.clientY);
        if (column !== hoveredColumn) {
            if (hoveredColumn) {
                hoveredColumn.classList.remove('column-hover');
            }

            // Remove existing ghost
            removeGhostCard();

            hoveredColumn = column;
            if (hoveredColumn) {
                hoveredColumn.classList.add('column-hover');

                // Show ghost in target column if it's different from source
                const targetCategory = hoveredColumn.dataset.category;
                if (targetCategory && targetCategory !== draggedFromCategory) {
                    ghostCard = createGhostCard(targetCategory);
                    if (ghostCard) {
                        const tasksGrid = hoveredColumn.querySelector('.tasks-grid');
                        const addButton = tasksGrid.querySelector('.task-card--add');
                        tasksGrid.insertBefore(ghostCard, addButton);
                    }
                }
            }
        }
    }

    async function endDrag(e) {
        if (!isDragging || !draggedCard) return;

        const dropRect = editDropZone.getBoundingClientRect();
        const cardCenterX = e.clientX;
        const cardCenterY = e.clientY;

        const droppedInEditZone = cardCenterX >= dropRect.left && cardCenterX <= dropRect.right &&
                             cardCenterY >= dropRect.top && cardCenterY <= dropRect.bottom;

        // Check of we in een andere kolom droppen
        const targetColumn = getColumnAtPosition(e.clientX, e.clientY);
        const targetCategory = targetColumn ? targetColumn.dataset.category : null;

        // Verwijder column highlights en ghost
        document.querySelectorAll('.page--overzicht .column').forEach(col => {
            col.classList.remove('drop-target', 'column-hover');
        });
        hoveredColumn = null;
        removeGhostCard();

        if (droppedInEditZone) {
            const column = placeholder.closest('.column');
            const cardToEdit = draggedCard;
            resetCardPosition(true);
            draggedCard = null;
            draggedTaskData = null;
            draggedFromCategory = null;
            openEditModal(cardToEdit, column, false);
        } else if (targetCategory && targetCategory !== draggedFromCategory) {
            // Verplaats taak naar andere kolom
            await moveTaskToColumn(targetCategory);
            resetCardPosition(false);
        } else {
            snapBackCard();
        }

        editDropZone.classList.remove('visible', 'drag-over');
        document.body.classList.remove('is-dragging');
        document.body.style.userSelect = '';
    }

    async function moveTaskToColumn(targetCategory) {
        if (!draggedTaskData || !draggedFromCategory) return;

        const sourceIndex = parseInt(draggedCard.dataset.index);

        // Verwijder uit source
        tasksData[draggedFromCategory].splice(sourceIndex, 1);

        // Converteer task data naar target format
        let newTask;
        if (targetCategory === 'inbox') {
            newTask = {
                titel: draggedTaskData.titel || draggedTaskData.naam || 'Taak',
                completed: false
            };
        } else if (targetCategory === 'planning') {
            newTask = {
                titel: draggedTaskData.titel || draggedTaskData.naam || 'Taak',
                uren: draggedTaskData.uren || null,
                completed: false
            };
        } else {
            // bellen of mailen
            newTask = {
                naam: draggedTaskData.naam || draggedTaskData.titel || 'Contact',
                taak: draggedTaskData.taak || '',
                completed: false
            };
        }

        // Voeg toe aan target
        if (!tasksData[targetCategory]) tasksData[targetCategory] = [];
        tasksData[targetCategory].push(newTask);

        draggedTaskData = null;
        draggedFromCategory = null;

        await saveAllTasks();
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
            draggedTaskData = null;
            draggedFromCategory = null;
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
            draggedTaskData = null;
            draggedFromCategory = null;
        }, 350);
    }

    // ===================
    // EDIT MODAL
    // ===================
    function openEditModal(task, column, isNew = false) {
        currentTask = task;
        currentColumn = column;
        isNewTask = isNew;

        const category = column.dataset.category;
        const isPlanningOrInbox = category === 'planning' || category === 'inbox';

        if (isPlanningOrInbox) {
            editInput.classList.remove('hidden');
            editInput.style.display = '';
            contactFields.classList.add('hidden');
            timeSelector.classList.toggle('hidden', category === 'inbox');
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
            const taskCategory = task.dataset.category;
            const index = parseInt(task.dataset.index);
            const taskData = tasksData[taskCategory][index];

            if (taskData) {
                if (taskCategory === 'inbox' || taskCategory === 'planning') {
                    editInput.value = taskData.titel || '';
                    selectedTime = taskData.uren ? String(taskData.uren) : null;
                    timeBtns.forEach(btn => {
                        if (selectedTime && btn.dataset.time === selectedTime) {
                            btn.classList.add('selected');
                        } else {
                            btn.classList.remove('selected');
                        }
                    });
                } else {
                    editContactName.value = taskData.naam || '';
                    editContactTask.value = taskData.taak || '';
                }
            }
        }

        editModal.classList.add('active');

        setTimeout(() => {
            if (isPlanningOrInbox) {
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
    }

    async function saveTask() {
        const category = currentColumn.dataset.category;

        if (category === 'inbox' || category === 'planning') {
            const value = editInput.value.trim();
            if (!value) {
                closeEditModal();
                return;
            }

            if (isNewTask) {
                if (!tasksData[category]) tasksData[category] = [];
                const newTask = {
                    titel: value,
                    completed: false
                };
                if (category === 'planning') {
                    newTask.uren = selectedTime ? parseInt(selectedTime) : null;
                }
                tasksData[category].push(newTask);
            } else {
                const taskCategory = currentTask.dataset.category;
                const index = parseInt(currentTask.dataset.index);
                tasksData[taskCategory][index] = {
                    ...tasksData[taskCategory][index],
                    titel: value
                };
                if (taskCategory === 'planning') {
                    tasksData[taskCategory][index].uren = selectedTime ? parseInt(selectedTime) : null;
                }
            }
        } else {
            const name = editContactName.value.trim();
            const task = editContactTask.value.trim();

            if (!name && !task) {
                closeEditModal();
                return;
            }

            if (isNewTask) {
                if (!tasksData[category]) tasksData[category] = [];
                tasksData[category].push({
                    naam: name,
                    taak: task,
                    completed: false
                });
            } else {
                const taskCategory = currentTask.dataset.category;
                const index = parseInt(currentTask.dataset.index);
                tasksData[taskCategory][index] = {
                    ...tasksData[taskCategory][index],
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
                    const wasCompleted = tasksData[category][index].completed;
                    tasksData[category][index].completed = !wasCompleted;

                    // Sla completedAt op wanneer taak wordt afgevinkt
                    if (!wasCompleted) {
                        tasksData[category][index].completedAt = new Date().toISOString();
                    } else {
                        delete tasksData[category][index].completedAt;
                    }

                    card.classList.add('hover-blocked');
                    await saveAllTasks();
                }
            }
        });

        card.addEventListener('mouseleave', () => {
            card.classList.remove('hover-blocked');
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

    // Global Enter/Escape handler for edit modal (works from any element)
    editModal.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
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
