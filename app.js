import { getTasksFromCloud, saveTasksToCloud, subscribeToTasks, getContactsFromCloud, saveContactsToCloud, subscribeToMails, addMailToCloud, updateMailInCloud, deleteMailFromCloud } from './firebase.js';
import { initMailWorker, updateWorkerMails, getWorkerStatus } from './mail-worker.js';

document.addEventListener('DOMContentLoaded', () => {
    const editModal = document.getElementById('editModal');
    const editInput = document.getElementById('editInput');
    const contactFields = document.getElementById('contactFields');
    const editContactName = document.getElementById('editContactName');
    const editContactTask = document.getElementById('editContactTask');
    const timeSelector = document.getElementById('timeSelector');
    const timeBtns = document.querySelectorAll('.time-btn');
    const editConfirm = document.getElementById('editConfirm');
    const editDelete = document.getElementById('editDelete');
    const editDropZone = document.getElementById('editDropZone');

    // Page elements
    const sidebarBtns = document.querySelectorAll('.sidebar-btn');
    const pages = document.querySelectorAll('.page');

    // Invoer elements
    const transcriptInput = document.getElementById('transcriptInput');
    const invoerLoader = document.getElementById('invoerLoader');

    // Profiel elements
    const contactInput = document.getElementById('contactInput');
    const contactenList = document.getElementById('contactenList');

    let currentTask = null;
    let currentColumn = null;
    let isNewTask = false;
    let selectedTime = null;

    // Utility: minuten formatteren voor weergave
    function formatMinutes(min) {
        if (!min) return '.';
        if (min >= 60) return (min / 60) + 'u';
        return min + 'm';
    }

    // Migratie: oude uren (1,2,3,6) naar minuten (60,120,180,360)
    function migrateUrenToMinutes(data) {
        let migrated = false;
        if (data.planning) {
            data.planning.forEach(task => {
                if (task.uren && task.uren <= 6) {
                    task.uren = task.uren * 60;
                    migrated = true;
                }
            });
        }
        return migrated;
    }

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
    let hoverBlockedCard = null; // Onthoudt welke kaart hover-blocked moet blijven na re-render

    // Taken data (in-memory, synced met Firebase)
    let tasksData = {
        inbox: [],
        planning: [],
        bellen: [],
        mailen: []
    };

    // Vorige staat voor detectie van nieuwe taken
    let previousTaskCounts = {
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

            // Migreer oude uren-waarden naar minuten (eenmalig)
            if (migrateUrenToMinutes(data)) {
                saveTasksToCloud(data);
            }

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
        const planningGrid = document.querySelector('.page--overzicht .column[data-category="planning"] .tasks-grid');
        const bellenGrid = document.querySelector('.page--overzicht .column[data-category="bellen"] .tasks-grid');
        const mailenGrid = document.querySelector('.page--overzicht .column[data-category="mailen"] .tasks-grid');

        // Detecteer nieuwe taken
        const newTaskIndices = {
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
        [planningGrid, bellenGrid, mailenGrid].forEach(grid => {
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
            planning: tasksData.planning ? tasksData.planning.length : 0,
            bellen: tasksData.bellen ? tasksData.bellen.length : 0,
            mailen: tasksData.mailen ? tasksData.mailen.length : 0
        };

        // Render triage pagina
        renderTriagePage();
        updateTriageBadge();
        updateColumnSummaries();

        if (isInitialLoad) {
            setTimeout(() => { isInitialLoad = false; }, 2000);
        }
    }

    function applyHoverBlockedIfNeeded(card, category, index) {
        // Als deze kaart net is geklikt, behoud de hover-blocked state
        if (hoverBlockedCard &&
            hoverBlockedCard.category === category &&
            hoverBlockedCard.index === index) {
            card.classList.add('hover-blocked');
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
        applyHoverBlockedIfNeeded(card, 'inbox', index);
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
                <span class="subtask-count">${formatMinutes(task.uren)}</span>
            </div>
        `;
        attachCardListeners(card);
        applyHoverBlockedIfNeeded(card, 'planning', index);
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
        applyHoverBlockedIfNeeded(card, category, index);
        return card;
    }

    async function saveAllTasks() {
        await saveTasksToCloud(tasksData);
    }

    // ===================
    // PROFIEL MANAGEMENT
    // ===================
    function renderContactenList() {
        if (!contactenList) return;
        contactenList.innerHTML = '';

        contacten.forEach((naam, index) => {
            const item = document.createElement('div');
            item.className = 'profiel-contact';
            item.innerHTML = `
                <span class="profiel-contact-name">${naam}</span>
                <button class="profiel-contact-delete" data-index="${index}">
                    <img src="assets/icons/close.svg" alt="Verwijder">
                </button>
            `;
            item.querySelector('.profiel-contact-delete').addEventListener('click', async () => {
                contacten.splice(index, 1);
                await saveContactsToCloud(contacten);
                renderContactenList();
            });
            contactenList.appendChild(item);
        });
    }

    function loadContactenToTextarea() {
        renderContactenList();
    }

    if (contactInput) {
        contactInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const naam = contactInput.value.trim();
                if (!naam) return;
                contacten.push(naam);
                await saveContactsToCloud(contacten);
                renderContactenList();
                contactInput.value = '';
            }
        });
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
            // Enter verstuurt, Shift+Enter voor nieuwe regel
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const transcript = transcriptInput.value.trim();
                if (!transcript) return;

                transcriptInput.disabled = true;
                if (invoerLoader) invoerLoader.classList.remove('hidden');

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
                    if (invoerLoader) invoerLoader.classList.add('hidden');
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
            // Als bron inbox/planning is, gebruik "..." voor naam (geen titel overnemen)
            const fromInboxOrPlanning = draggedFromCategory === 'inbox' || draggedFromCategory === 'planning';
            const naam = fromInboxOrPlanning ? '...' : (draggedTaskData.naam || '...');
            const taak = draggedTaskData.taak || (fromInboxOrPlanning ? draggedTaskData.titel : '') || '';
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
        // Drop zone is nu fixed links via CSS, geen dynamische positionering nodig
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
            // Sleep naar beneden = direct verwijderen
            const category = draggedFromCategory;
            const index = parseInt(draggedCard.dataset.index);

            if (tasksData[category] && tasksData[category][index]) {
                tasksData[category].splice(index, 1);
            }

            resetCardPosition(false);
            await saveAllTasks();
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
        const fromContactColumn = draggedFromCategory === 'bellen' || draggedFromCategory === 'mailen';

        if (targetCategory === 'inbox') {
            // Bij terugsleepen van bellen/mailen: gebruik taak als titel (niet naam)
            newTask = {
                titel: draggedTaskData.titel || (fromContactColumn ? draggedTaskData.taak : null) || 'Taak',
                completed: false
            };
        } else if (targetCategory === 'planning') {
            // Bij terugsleepen van bellen/mailen: gebruik taak als titel (niet naam)
            newTask = {
                titel: draggedTaskData.titel || (fromContactColumn ? draggedTaskData.taak : null) || 'Taak',
                uren: draggedTaskData.uren || null,
                completed: false
            };
        } else {
            // bellen of mailen
            // Als bron inbox/planning is, laat naam leeg met "..." (titel gaat naar taak veld)
            const fromInboxOrPlanning = draggedFromCategory === 'inbox' || draggedFromCategory === 'planning';
            newTask = {
                naam: fromInboxOrPlanning ? '...' : (draggedTaskData.naam || '...'),
                taak: draggedTaskData.taak || (fromInboxOrPlanning ? draggedTaskData.titel : '') || '',
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

        // Hide delete button for new tasks, show for existing
        editDelete.style.display = isNew ? 'none' : '';

        editModal.classList.add('active');

        setTimeout(() => {
            if (isPlanningOrInbox) {
                editInput.focus();
                editInput.select();
            } else {
                editContactName.focus();
                editContactName.select();
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

        card.addEventListener('click', (e) => {
            if (!isDragging && Date.now() - mouseDownTime < 250) {
                // Klik opent edit modal
                const column = card.closest('.column');
                openEditModal(card, column, false);
            }
        });

        card.addEventListener('mouseleave', () => {
            card.classList.remove('hover-blocked');
            // Clear de onthouden hover-blocked state
            if (hoverBlockedCard &&
                hoverBlockedCard.category === card.dataset.category &&
                hoverBlockedCard.index === parseInt(card.dataset.index)) {
                hoverBlockedCard = null;
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

    editDelete.addEventListener('click', async () => {
        if (!currentTask || isNewTask) return;
        const category = currentTask.dataset.category;
        const index = parseInt(currentTask.dataset.index);
        if (tasksData[category] && tasksData[category][index] !== undefined) {
            tasksData[category].splice(index, 1);
            await saveAllTasks();
        }
        closeEditModal();
    });

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
            saveTask();
        }
    });

    // Add button clicks
    document.querySelectorAll('.add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const column = btn.closest('.column');
            openEditModal(null, column, true);
        });
    });

    // Triage add button — hergebruik edit modal met fake column element
    const triageAddBtn = document.getElementById('triageAddBtn');
    if (triageAddBtn) {
        triageAddBtn.addEventListener('click', () => {
            const fakeColumn = { dataset: { category: 'inbox' } };
            openEditModal(null, fakeColumn, true);
        });
    }

    // ===================
    // TRIAGE SYSTEEM
    // ===================
    let triageIsDragging = false;
    let triageDraggedItem = null;
    let triageDraggedIndex = null;
    let triageDragStartX = 0;
    let triageDragStartY = 0;
    let triageItemOriginalRect = null;
    let triagePlaceholder = null;
    let triageHoveredZone = null;
    let triageHoldTimeout = null;
    let triageInlineEditActive = false;

    function renderTriagePage() {
        if (triageInlineEditActive) return;
        const list = document.getElementById('triageInboxList');
        if (!list) return;

        // Verwijder alleen inbox items, bewaar icon kaartje en add button
        const existingItems = list.querySelectorAll('.triage-inbox-item, .triage-inbox-empty');
        existingItems.forEach(item => item.remove());

        const addBtn = list.querySelector('.triage-add');

        if (!tasksData.inbox || tasksData.inbox.length === 0) {
            return;
        }

        tasksData.inbox.forEach((task, index) => {
            const item = document.createElement('div');
            item.className = 'triage-inbox-item';
            item.dataset.index = index;
            item.innerHTML = `
                <div class="task-content">
                    <span class="task-title">${task.titel}</span>
                </div>
            `;
            attachTriageDragListeners(item);
            list.insertBefore(item, addBtn);
        });
    }

    function updateTriageBadge() {
        const badge = document.getElementById('triageBadge');
        if (!badge) return;
        const count = tasksData.inbox ? tasksData.inbox.length : 0;
        if (count > 0) {
            badge.textContent = count;
            badge.classList.add('visible');
        } else {
            badge.classList.remove('visible');
        }
    }

    // Triage drag listeners
    function attachTriageDragListeners(item) {
        item.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();

            triageDragStartX = e.clientX;
            triageDragStartY = e.clientY;

            const capturedItem = item;
            triageHoldTimeout = setTimeout(() => {
                startTriageDrag(capturedItem, e);
            }, 100);
        });
    }

    let triageDragRotation = 0;

    function startTriageDrag(item, e) {
        if (triageIsDragging) return;

        triageIsDragging = true;
        triageDraggedItem = item;
        triageDraggedIndex = parseInt(item.dataset.index);
        triageItemOriginalRect = item.getBoundingClientRect();
        triageDragRotation = getRandomRotation();

        // Placeholder
        triagePlaceholder = document.createElement('div');
        triagePlaceholder.className = 'triage-inbox-placeholder';
        item.parentNode.insertBefore(triagePlaceholder, item);

        // Maak item fixed
        item.classList.add('dragging');
        item.style.width = triageItemOriginalRect.width + 'px';
        item.style.height = triageItemOriginalRect.height + 'px';
        item.style.left = triageItemOriginalRect.left + 'px';
        item.style.top = triageItemOriginalRect.top + 'px';

        // Start animatie naar rotatie
        item.style.transform = 'scale(1) rotate(0deg)';
        item.offsetHeight;
        item.style.transform = `scale(1.05) rotate(${triageDragRotation}deg)`;

        // Toon delete zone (links)
        editDropZone.classList.add('visible');

        document.body.classList.add('is-triage-dragging');
        document.body.style.userSelect = 'none';
    }

    function getTriageZoneAtPosition(x, y) {
        const zones = document.querySelectorAll('.triage-zone-list');
        for (const zone of zones) {
            const rect = zone.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return zone;
            }
        }
        return null;
    }

    function updateTriageDrag(e) {
        if (!triageIsDragging || !triageDraggedItem) return;

        const deltaX = e.clientX - triageDragStartX;
        const deltaY = e.clientY - triageDragStartY;

        triageDraggedItem.style.left = (triageItemOriginalRect.left + deltaX) + 'px';
        triageDraggedItem.style.top = (triageItemOriginalRect.top + deltaY) + 'px';

        // Delete zone hover
        const dropRect = editDropZone.getBoundingClientRect();
        if (e.clientX >= dropRect.left && e.clientX <= dropRect.right &&
            e.clientY >= dropRect.top && e.clientY <= dropRect.bottom) {
            editDropZone.classList.add('drag-over');
        } else {
            editDropZone.classList.remove('drag-over');
        }

        // Zone hover detectie
        const zone = getTriageZoneAtPosition(e.clientX, e.clientY);
        if (zone !== triageHoveredZone) {
            if (triageHoveredZone) triageHoveredZone.classList.remove('zone-hover');
            triageHoveredZone = zone;
            if (triageHoveredZone) triageHoveredZone.classList.add('zone-hover');
        }
    }

    async function endTriageDrag(e) {
        if (!triageIsDragging || !triageDraggedItem) return;

        // Check delete zone
        const dropRect = editDropZone.getBoundingClientRect();
        const droppedInDeleteZone = e.clientX >= dropRect.left && e.clientX <= dropRect.right &&
                                    e.clientY >= dropRect.top && e.clientY <= dropRect.bottom;

        const zone = getTriageZoneAtPosition(e.clientX, e.clientY);
        const targetZone = zone ? zone.closest('.triage-zone') : null;
        const zoneName = targetZone ? targetZone.dataset.zone : null;

        // Cleanup hover
        if (triageHoveredZone) {
            triageHoveredZone.classList.remove('zone-hover');
            triageHoveredZone = null;
        }
        editDropZone.classList.remove('visible', 'drag-over');

        if (droppedInDeleteZone && tasksData.inbox && tasksData.inbox[triageDraggedIndex]) {
            // Verwijder taak
            tasksData.inbox.splice(triageDraggedIndex, 1);
            resetTriageDrag();
            await saveAllTasks();
        } else if (zoneName && tasksData.inbox && tasksData.inbox[triageDraggedIndex]) {
            const task = { ...tasksData.inbox[triageDraggedIndex] };
            tasksData.inbox.splice(triageDraggedIndex, 1);

            // Reset drag state
            resetTriageDrag();
            await saveAllTasks();

            // Toon inline editor
            const zoneList = targetZone.querySelector('.triage-zone-list');
            if (zoneName === 'planning') {
                showTriageTimePicker(task, zoneList);
            } else {
                showTriageNameField(task, zoneList, zoneName);
            }
        } else {
            // Snap back
            resetTriageDrag();
        }
    }

    function resetTriageDrag() {
        if (triageDraggedItem) {
            triageDraggedItem.classList.remove('dragging');
            triageDraggedItem.style.width = '';
            triageDraggedItem.style.height = '';
            triageDraggedItem.style.left = '';
            triageDraggedItem.style.top = '';
            triageDraggedItem.style.transform = '';
        }
        if (triagePlaceholder && triagePlaceholder.parentNode) {
            triagePlaceholder.parentNode.removeChild(triagePlaceholder);
        }

        triageIsDragging = false;
        triageDraggedItem = null;
        triageDraggedIndex = null;
        triagePlaceholder = null;
        editDropZone.classList.remove('visible', 'drag-over');
        document.body.classList.remove('is-triage-dragging');
        document.body.style.userSelect = '';
    }

    // Wire triage drag into global listeners
    document.addEventListener('mousemove', (e) => {
        if (triageIsDragging) updateTriageDrag(e);
    });

    document.addEventListener('mouseup', (e) => {
        if (triageHoldTimeout) {
            clearTimeout(triageHoldTimeout);
            triageHoldTimeout = null;
        }
        if (triageIsDragging) endTriageDrag(e);
    });

    // ===================
    // INLINE EDITING
    // ===================
    function showTriageTimePicker(task, zoneList) {
        triageInlineEditActive = true;

        // Wrapper: kaartje + zwevende knoppen
        const wrapper = document.createElement('div');
        wrapper.className = 'triage-inline-wrapper';

        // Het kaartje zelf (zelfde stijl als inbox kaartje)
        const card = document.createElement('div');
        card.className = 'triage-zone-item triage-inline-card';
        card.innerHTML = `<span class="task-title">${task.titel}</span>`;

        // Zwevende knoppen ernaast
        const actions = document.createElement('div');
        actions.className = 'triage-float-actions';
        actions.innerHTML = `
            <button class="triage-time-btn" data-min="15">15m</button>
            <button class="triage-time-btn" data-min="30">30m</button>
            <button class="triage-time-btn" data-min="60">1u</button>
            <button class="triage-time-btn" data-min="120">2u</button>
            <button class="triage-time-btn" data-min="180">3u</button>
            <button class="triage-time-btn" data-min="360">6u</button>
        `;

        wrapper.appendChild(card);
        wrapper.appendChild(actions);

        actions.querySelectorAll('.triage-time-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const minutes = parseInt(btn.dataset.min);
                if (!tasksData.planning) tasksData.planning = [];
                tasksData.planning.push({
                    titel: task.titel,
                    uren: minutes,
                    completed: false
                });
                wrapper.remove();
                triageInlineEditActive = false;
                await saveAllTasks();
            });
        });

        zoneList.appendChild(wrapper);
    }

    function detectContactName(titel) {
        if (!contacten || contacten.length === 0) return null;
        const lowerTitel = titel.toLowerCase();
        for (const contact of contacten) {
            if (lowerTitel.includes(contact.toLowerCase())) {
                // Verwijder de naam uit de titel voor de taakbeschrijving
                const regex = new RegExp(contact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                let taak = titel.replace(regex, '').replace(/^\s*[,:\-–]\s*/, '').replace(/\s*[,:\-–]\s*$/, '').trim();
                if (!taak) taak = titel;
                return { naam: contact, taak };
            }
        }
        return null;
    }

    function showTriageNameField(task, zoneList, category) {
        // Check eerst of er al een naam in zit
        const detected = detectContactName(task.titel);

        if (detected) {
            // Naam gevonden — direct opslaan
            if (!tasksData[category]) tasksData[category] = [];
            tasksData[category].push({
                naam: detected.naam,
                taak: detected.taak,
                completed: false
            });
            saveAllTasks();
            return;
        }

        // Geen naam — toon kaartje met zwevend invoerveld
        triageInlineEditActive = true;

        const wrapper = document.createElement('div');
        wrapper.className = 'triage-inline-wrapper';

        // Het kaartje zelf
        const card = document.createElement('div');
        card.className = 'triage-zone-item triage-inline-card';
        card.innerHTML = `<span class="task-title">${task.titel}</span>`;

        // Zwevend invoerveld ernaast
        const actions = document.createElement('div');
        actions.className = 'triage-float-actions';
        actions.innerHTML = `<input type="text" class="triage-inline-name" placeholder="Wie?">`;

        wrapper.appendChild(card);
        wrapper.appendChild(actions);

        const nameInput = actions.querySelector('.triage-inline-name');

        const confirmName = async () => {
            const naam = nameInput.value.trim() || '...';
            if (!tasksData[category]) tasksData[category] = [];
            tasksData[category].push({
                naam: naam,
                taak: task.titel,
                completed: false
            });
            wrapper.remove();
            triageInlineEditActive = false;
            await saveAllTasks();
        };

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmName();
            } else if (e.key === 'Escape') {
                if (!tasksData.inbox) tasksData.inbox = [];
                tasksData.inbox.push(task);
                wrapper.remove();
                triageInlineEditActive = false;
                saveAllTasks();
            }
        });

        nameInput.addEventListener('blur', () => {
            setTimeout(() => {
                if (wrapper.parentNode) confirmName();
            }, 100);
        });

        zoneList.appendChild(wrapper);
        setTimeout(() => nameInput.focus(), 50);
    }

    // ===================
    // COLUMN SUMMARIES
    // ===================
    function updateColumnSummaries() {
        updatePlanningSummary();
        updateContactSummary('bellen', 'bellenSummary');
        updateContactSummary('mailen', 'mailenSummary');
    }

    function updatePlanningSummary() {
        const summary = document.getElementById('planningSummary');
        if (!summary) return;

        const tasks = tasksData.planning ? tasksData.planning.filter(t => !t.completed) : [];
        const count = tasks.length;

        if (count === 0) {
            summary.classList.remove('visible');
            return;
        }

        const totalMinutes = tasks.reduce((sum, t) => sum + (t.uren || 0), 0);
        const timeStr = totalMinutes >= 60 ? formatMinutes(totalMinutes) : totalMinutes + ' min';
        summary.querySelector('.summary-text').textContent = `${count} to do's — ${timeStr}`;
        summary.classList.add('visible');
    }

    function updateContactSummary(category, summaryId) {
        const summary = document.getElementById(summaryId);
        if (!summary) return;

        const tasks = tasksData[category] ? tasksData[category].filter(t => !t.completed) : [];
        const count = tasks.length;

        if (count === 0) {
            summary.classList.remove('visible');
            return;
        }

        const minutes = count * 5;
        summary.querySelector('.summary-text').textContent = `${count} to do's — ${minutes} min`;
        summary.classList.add('visible');
    }

    // Copy handlers voor summaries
    document.querySelectorAll('.summary-copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const column = btn.closest('.column');
            const category = column.dataset.category;
            const label = category === 'bellen' ? 'Bellen' : 'Mailen';
            const tasks = tasksData[category] ? tasksData[category].filter(t => !t.completed) : [];
            const minutes = tasks.length * 5;

            let text = `${label} (${minutes} min)\n`;
            tasks.forEach(t => {
                text += `- ${t.naam}: ${t.taak}\n`;
            });
            text = text.trim();

            // Clipboard met fallback voor non-HTTPS
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).catch(() => {
                    fallbackCopy(text);
                });
            } else {
                fallbackCopy(text);
            }

            btn.classList.add('copied');
            setTimeout(() => btn.classList.remove('copied'), 1500);
        });
    });

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }

    // ===================
    // MAIL DICTATIE
    // ===================
    let mailsData = [];
    let currentMailResult = null;
    let speechRecognition = null;
    let isRecording = false;

    const mailTranscript = document.getElementById('mailTranscript');
    const mailMicBtn = document.getElementById('mailMicBtn');
    const mailSubmitBtn = document.getElementById('mailSubmitBtn');
    const mailQueueEl = document.getElementById('mailQueue');
    const mailWorkerStatus = document.getElementById('mailWorkerStatus');
    const mailResultModal = document.getElementById('mailResultModal');
    const mailResultSubject = document.getElementById('mailResultSubject');
    const mailResultBody = document.getElementById('mailResultBody');
    const mailResultClose = document.getElementById('mailResultClose');
    const mailResultCopy = document.getElementById('mailResultCopy');

    function escapeHtml(s) {
        if (!s) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatTimeAgo(iso) {
        if (!iso) return '';
        const diff = Date.now() - new Date(iso).getTime();
        const sec = Math.floor(diff / 1000);
        if (sec < 60) return 'net';
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min}m`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr}u`;
        return `${Math.floor(hr / 24)}d`;
    }

    function statusLabel(status) {
        switch (status) {
            case 'pending': return 'wacht';
            case 'processing': return 'bezig';
            case 'done': return 'klaar';
            case 'failed': return 'mislukt';
            default: return status;
        }
    }

    function renderMailPage() {
        if (!mailQueueEl) return;
        mailQueueEl.innerHTML = '';

        if (!mailsData || mailsData.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'mail-empty';
            empty.textContent = 'Nog geen mails in de queue.';
            mailQueueEl.appendChild(empty);
            updateMailBadge();
            return;
        }

        mailsData.forEach(mail => {
            const item = document.createElement('div');
            item.className = `mail-item mail-item--${mail.status}`;
            item.dataset.mailId = mail.id;

            const preview = (mail.transcript || '').slice(0, 140);
            const modeLabel = mail.mode === 'claude' ? '⚡' : '🏠';

            item.innerHTML = `
                <div class="mail-item-header">
                    <span class="mail-item-status">${statusLabel(mail.status)}</span>
                    <span class="mail-item-mode">${modeLabel}</span>
                    <span class="mail-item-time">${formatTimeAgo(mail.createdAt)}</span>
                </div>
                <div class="mail-item-transcript">${escapeHtml(preview)}${mail.transcript && mail.transcript.length > 140 ? '…' : ''}</div>
                ${mail.status === 'done' ? `<div class="mail-item-subject">${escapeHtml(mail.subject || '')}</div>` : ''}
                ${mail.status === 'failed' ? `<div class="mail-item-error">${escapeHtml(mail.error || 'onbekende fout')}</div>` : ''}
                <div class="mail-item-actions">
                    ${mail.status === 'pending' && mail.mode !== 'claude' ? `<button class="mail-item-btn mail-item-btn--escalate" data-action="escalate">⚡ nu</button>` : ''}
                    ${mail.status === 'done' ? `<button class="mail-item-btn mail-item-btn--open" data-action="open">openen</button>` : ''}
                    ${mail.status === 'failed' ? `<button class="mail-item-btn mail-item-btn--retry" data-action="retry">opnieuw</button>` : ''}
                    <button class="mail-item-btn mail-item-btn--delete" data-action="delete">
                        <img src="assets/icons/trash.svg" alt="Verwijderen">
                    </button>
                </div>
            `;

            item.querySelectorAll('[data-action]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    handleMailAction(mail, action);
                });
            });

            mailQueueEl.appendChild(item);
        });

        updateMailBadge();
    }

    function updateMailBadge() {
        const badge = document.getElementById('mailBadge');
        if (!badge) return;
        const count = mailsData.filter(m => m.status === 'done').length;
        if (count > 0) {
            badge.textContent = count;
            badge.classList.add('visible');
        } else {
            badge.classList.remove('visible');
        }
    }

    async function handleMailAction(mail, action) {
        if (action === 'delete') {
            await deleteMailFromCloud(mail.id);
        } else if (action === 'escalate') {
            await updateMailInCloud(mail.id, {
                mode: 'claude',
                status: 'pending',
                workerLease: null,
                attempts: 0,
                error: null
            });
        } else if (action === 'retry') {
            await updateMailInCloud(mail.id, {
                status: 'pending',
                workerLease: null,
                attempts: 0,
                error: null
            });
        } else if (action === 'open') {
            openMailResultModal(mail);
        }
    }

    function openMailResultModal(mail) {
        currentMailResult = mail;
        mailResultSubject.textContent = mail.subject || '';
        mailResultBody.textContent = mail.body || '';
        mailResultModal.classList.add('active');
    }

    function closeMailResultModal() {
        mailResultModal.classList.remove('active');
        currentMailResult = null;
    }

    async function copyMailResult() {
        if (!currentMailResult) return;
        const text = `Onderwerp: ${currentMailResult.subject}\n\n${currentMailResult.body}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(text);
            } catch (e) {
                fallbackCopy(text);
            }
        } else {
            fallbackCopy(text);
        }
        mailResultCopy.textContent = 'Gekopieerd!';
        setTimeout(() => { mailResultCopy.textContent = 'Kopieer'; }, 1500);
    }

    // ===================
    // SPEECH RECOGNITION
    // ===================
    function initSpeechRecognition() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return null;

        const rec = new SR();
        rec.lang = 'nl-NL';
        rec.continuous = true;
        rec.interimResults = true;

        let finalTranscript = '';

        rec.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interim += transcript;
                }
            }
            mailTranscript.value = finalTranscript + interim;
        };

        rec.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            stopRecording();
        };

        rec.onend = () => {
            if (isRecording) {
                // Auto-restart bij continuous mode
                try { rec.start(); } catch (e) {}
            }
        };

        rec._reset = () => { finalTranscript = mailTranscript.value; };
        return rec;
    }

    function startRecording() {
        if (!speechRecognition) {
            speechRecognition = initSpeechRecognition();
        }
        if (!speechRecognition) {
            mailTranscript.focus();
            alert('Dictatie niet beschikbaar in deze browser. Gebruik de microfoon-knop op je toetsenbord.');
            return;
        }
        isRecording = true;
        speechRecognition._reset();
        try {
            speechRecognition.start();
            mailMicBtn.classList.add('recording');
        } catch (e) {
            console.error(e);
            isRecording = false;
        }
    }

    function stopRecording() {
        isRecording = false;
        if (speechRecognition) {
            try { speechRecognition.stop(); } catch (e) {}
        }
        mailMicBtn.classList.remove('recording');
    }

    async function submitMailTranscript() {
        const text = mailTranscript.value.trim();
        if (!text) return;
        stopRecording();
        const id = await addMailToCloud({ transcript: text, mode: 'local' });
        if (id) {
            mailTranscript.value = '';
        }
    }

    function updateWorkerStatusUI() {
        if (!mailWorkerStatus) return;
        const status = getWorkerStatus();
        const label = mailWorkerStatus.querySelector('.mail-worker-label');
        if (status.lmStudio && status.lmStudio.ok) {
            mailWorkerStatus.classList.add('online');
            if (label) label.textContent = `LM Studio online (${status.lmStudio.modelId || 'model'})`;
        } else {
            mailWorkerStatus.classList.remove('online');
            if (label) label.textContent = 'LM Studio offline';
        }
    }

    // Event listeners mail-pagina
    if (mailMicBtn) {
        mailMicBtn.addEventListener('click', () => {
            if (isRecording) {
                stopRecording();
            } else {
                startRecording();
            }
        });
    }

    if (mailSubmitBtn) {
        mailSubmitBtn.addEventListener('click', submitMailTranscript);
    }

    if (mailTranscript) {
        mailTranscript.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitMailTranscript();
            }
        });
    }

    if (mailResultClose) {
        mailResultClose.addEventListener('click', closeMailResultModal);
    }
    if (mailResultCopy) {
        mailResultCopy.addEventListener('click', copyMailResult);
    }
    if (mailResultModal) {
        mailResultModal.addEventListener('click', (e) => {
            if (e.target === mailResultModal) closeMailResultModal();
        });
    }

    // Subscribe naar mails + start worker
    subscribeToMails((mails) => {
        mailsData = mails || [];
        updateWorkerMails(mailsData);
        renderMailPage();
    });

    initMailWorker();
    setInterval(updateWorkerStatusUI, 5000);
    updateWorkerStatusUI();

    // Initialize Firebase data
    initializeData();
});
