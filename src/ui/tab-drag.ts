export function initTabReorder(): void {
  const tabsContainer = document.querySelector('.tabs') as HTMLElement | null;
  if (!tabsContainer) return;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let dragTab: Element | null = null;
  let isDragging = false;
  const tabOrder: string[] | null = JSON.parse(localStorage.getItem('tabOrder') || 'null');

  if (tabOrder && tabOrder.length > 0) {
    const tabs = Array.from(tabsContainer.querySelectorAll('.tab'));
    const tabMap: Record<string, Element> = {};
    tabs.forEach(t => { tabMap[t.textContent!.trim()] = t; });
    tabOrder.forEach(name => {
      if (tabMap[name]) tabsContainer.appendChild(tabMap[name]);
    });
  }

  function saveTabOrder(): void {
    const tabs = Array.from(tabsContainer!.querySelectorAll('.tab'));
    const order = tabs.map(t => t.textContent!.trim());
    localStorage.setItem('tabOrder', JSON.stringify(order));
  }

  function getTabIndex(tab: Element): number {
    return Array.from(tabsContainer!.children).indexOf(tab);
  }

  function swapTabs(tab1: Element, tab2: Element): void {
    const parent = tabsContainer!;
    const idx1 = getTabIndex(tab1);
    const idx2 = getTabIndex(tab2);
    if (idx1 < idx2) {
      parent.insertBefore(tab2, tab1);
    } else {
      parent.insertBefore(tab1, tab2);
    }
  }

  tabsContainer.addEventListener('touchstart', function (e) {
    const tab = (e.target as Element).closest('.tab');
    if (!tab) return;
    longPressTimer = setTimeout(() => {
      isDragging = true;
      dragTab = tab;
      tab.classList.add('tab-dragging');
      if (navigator.vibrate) navigator.vibrate(50);
    }, 500);
  }, { passive: true });

  tabsContainer.addEventListener('touchmove', function (e) {
    if (!isDragging || !dragTab) return;
    e.preventDefault();
    const touch = e.touches[0];
    const tabs = Array.from(tabsContainer!.querySelectorAll('.tab'));
    for (const tab of tabs) {
      if (tab === dragTab) continue;
      const rect = tab.getBoundingClientRect();
      if (touch.clientX >= rect.left && touch.clientX <= rect.right) {
        tab.classList.add('tab-drag-over');
        swapTabs(dragTab, tab);
        break;
      } else {
        tab.classList.remove('tab-drag-over');
      }
    }
  }, { passive: false });

  tabsContainer.addEventListener('touchend', function () {
    if (longPressTimer) clearTimeout(longPressTimer);
    if (!isDragging || !dragTab) return;
    dragTab.classList.remove('tab-dragging');
    Array.from(tabsContainer!.querySelectorAll('.tab')).forEach(t => t.classList.remove('tab-drag-over'));
    saveTabOrder();
    isDragging = false;
    dragTab = null;
  });

  tabsContainer.addEventListener('touchcancel', function () {
    if (longPressTimer) clearTimeout(longPressTimer);
    if (dragTab) dragTab.classList.remove('tab-dragging');
    Array.from(tabsContainer!.querySelectorAll('.tab')).forEach(t => t.classList.remove('tab-drag-over'));
    isDragging = false;
    dragTab = null;
  });
}
