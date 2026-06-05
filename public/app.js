// Disable right-click and drag on all images
    document.addEventListener('contextmenu', function(e) { if (e.target.tagName === 'IMG') e.preventDefault(); });
    document.addEventListener('dragstart', function(e) { if (e.target.tagName === 'IMG') e.preventDefault(); });

    const gradients = [
      'linear-gradient(160deg, #0f766e, #14b8a6, #99f6e8)',
      'linear-gradient(160deg, #f43f5e, #fb923c, #facc15, #4ade80, #38bdf8, #a78bfa)',
      'linear-gradient(160deg, #94a3b8, #cbd5e1, #e2e8f0)',
      'linear-gradient(160deg, #78350f, #a16207, #fbbf24)',
      'linear-gradient(160deg, #6b21a8, #a78bfa, #e9d5ff)',
      'linear-gradient(160deg, #ea580c, #fb923c, #fed7aa)',
      'linear-gradient(160deg, #9ca3af, #d1d5db, #f3f4f6)',
      'linear-gradient(160deg, #7c3aed, #c084fc, #ede9fe)',
      'linear-gradient(160deg, #581c87, #9333ea, #d8b4fe)',
      'linear-gradient(160deg, #8b5cf6, #c4b5fd, #ede9fe)',
      'linear-gradient(160deg, #6d28d9, #a78bfa, #ddd6fe)',
      'linear-gradient(160deg, #64748b, #94a3b8, #cbd5e1)',
      'linear-gradient(160deg, #c2410c, #f97316, #fdba74)',
      'linear-gradient(160deg, #6b7280, #9ca3af, #d1d5db)',
      'linear-gradient(160deg, #1e3a5f, #2563eb, #f97316)',
      'linear-gradient(160deg, #6b7280, #9ca3af, #e5e7eb)',
      'linear-gradient(160deg, #7c3aed, #a78bfa, #e5e7eb)',
      'linear-gradient(160deg, #92400e, #d97706, #fbbf24)',
      'linear-gradient(160deg, #881337, #e11d48, #fda4af)',
      'linear-gradient(160deg, #7c3aed, #c084fc, #fbcfed)',
      'linear-gradient(160deg, #0891b2, #06b6d4, #a5f3fc)',
      'linear-gradient(160deg, #be123c, #fb7185, #fecdd3)',
      'linear-gradient(160deg, #4f46e5, #818cf8, #e0e7ff)',
      'linear-gradient(160deg, #059669, #34d399, #a7f3d0)',
      'linear-gradient(160deg, #d97706, #fbbf24, #fef3c7)'
    ];

    let materials = [];
    let currentUser = null;
    let currentCat = '人物';
    let currentSearch = '';
    let currentPage = 1;
        const perPage = 10;

    // Try to restore session from localStorage
    try {
      const saved = localStorage.getItem('lz_user');
      if (saved) {
        currentUser = JSON.parse(saved);
      }
    } catch(e) {}

    // ===== AI MAINTENANCE CONTROL =====
    let aiMaintenanceMode = false;

    async function checkAiMaintenance() {
      try {
        const r = await fetch("/api/settings/ai-maintenance");
        const d = await r.json();
        aiMaintenanceMode = d.maintenance;
        updateAiToggleUI();
      } catch(e) { console.error("Check AI maintenance failed:", e); }
    }

    function updateAiToggleUI() {
      const toggle = document.getElementById("aiMaintenanceToggle");
      const slider = document.getElementById("aiToggleSlider");
      const knob = document.getElementById("aiToggleKnob");
      const status = document.getElementById("aiMaintenanceStatus");
      if (!toggle) return;
      toggle.checked = !aiMaintenanceMode;
      if (aiMaintenanceMode) {
        slider.style.background = "#ef4444";
        knob.style.left = "3px";
        status.textContent = "维护中";
        status.style.color = "#ef4444";
      } else {
        slider.style.background = "#10b981";
        knob.style.left = "25px";
        status.textContent = "已开放";
        status.style.color = "#10b981";
      }
    }

    async function toggleAiMaintenance(checkbox) {
      const enabled = !checkbox.checked;
      try {
        const r = await fetch("/api/settings/ai-maintenance", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: currentUser.username, enabled })
        });
        const d = await r.json();
        if (d.success) {
          aiMaintenanceMode = d.maintenance;
          updateAiToggleUI();
        } else {
          alert(d.error || "设置失败");
          checkbox.checked = !checkbox.checked;
        }
      } catch(e) {
        alert("网络错误");
        checkbox.checked = !checkbox.checked;
      }
    }

    function handleAiClick() {
      if (aiMaintenanceMode) {
        alert("🔧 栗子AI生图系统维护中，请稍后再试！");
        return;
      }
      openAppPopup("/ai-image.html", "栗子AI生图");
    }

    // Check AI maintenance status on page load
    checkAiMaintenance();

    // ===== USER MANAGER POPUP =====
    function openUserManager() {
      document.getElementById('userManagerModal').classList.add('active');
      renderAdminUsers();
    }
    function closeUserManager() {
      document.getElementById('userManagerModal').classList.remove('active');
    }




    // ===== UTILITY FUNCTIONS =====
    // Generate device fingerprint
    function getDeviceId() {
      const nav = navigator;
      const screen = window.screen;
      const components = [
        nav.userAgent,
        nav.language,
        screen.colorDepth,
        screen.width + 'x' + screen.height,
        new Date().getTimezoneOffset(),
        nav.hardwareConcurrency || '',
        nav.platform || ''
      ];
      // Simple hash
      const str = components.join('|');
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return 'device_' + Math.abs(hash).toString(36);
    }

    // Detect if mobile device
    function isMobileDevice() {
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    // Hide desktop-only elements on mobile
    if (isMobileDevice()) {
      document.querySelectorAll('.desktop-only').forEach(el => el.style.display = 'none');
    }

    // HTML escape to prevent XSS
    function escapeHtml(text) {
      if (text == null) return '';
      return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    }
    // Traditional to Simplified Chinese conversion mapping (frontend preview; server does full conversion with opencc-js)
    const t2sMap = {
      '個':'个','麼':'么','為':'为','裡':'里','麵':'面','髮':'发','鬥':'斗',
      '鬱':'郁','後':'后','纔':'才','隻':'只','鬆':'松','髒':'脏','雲':'云',
      '醜':'丑','範':'范','穀':'谷','餘':'余','複':'复','剋':'克','穫':'获',
      '瞭':'了','衝':'冲','摺':'折','颱':'台','嚮':'向','鬍':'胡','衞':'卫',
      '蘋':'苹','蔣':'蒋','鬚':'须','徵':'征','裏':'里','繫':'系','係':'系',
      '儘':'尽','於':'于','體':'体','國':'国','產':'产','發':'发','門':'门',
      '時':'时','電':'电','機':'机','氣':'气','動':'动','會':'会','來':'来',
      '說':'说','這':'这','們':'们','從':'从','現':'现','長':'长','開':'开',
      '關':'关','點':'点','東':'东','樣':'样','頭':'头','邊':'边','進':'进',
      '遠':'远','車':'车','書':'书','學':'学','實':'实','話':'话','語':'语',
      '認':'认','讓':'让','變':'变','買':'买','賣':'卖','問':'问','間':'间',
      '圖':'图','團':'团','專':'专','隊':'队','難':'难','備':'备','報':'报',
      '護':'护','醫':'医','藥':'药','業':'业','樂':'乐','類':'类','禮':'礼',
      '豐':'丰','飛':'飞','飯':'饭','飲':'饮','館':'馆','響':'响','驚':'惊',
      '龍':'龙','龜':'龟','鳳':'凤','鳥':'鸟','馬':'马','魚':'鱼','麥':'麦',
      '黃':'黄','黨':'党','錢':'钱','銀':'银','鐵':'铁','鑰':'钥','陽':'阳',
      '陰':'阴','雜':'杂','離':'离','霧':'雾','靜':'静','頁':'页','風':'风'
    };
    function toSimplified(text) {
      if (!text) return text;
      return text.split('').map(c => t2sMap[c] || c).join('');
    }
    async function apiLogin(username, password) {
      const r = await fetch('/api/login', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          username,
          password,
          deviceId: getDeviceId(),
          isMobile: isMobileDevice()
        })
      });
      return r.json();
    }

    async function loadMaterials() {
      const grid = document.getElementById('cardGrid');
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#6b7280"><div style="font-size:14px;margin-bottom:12px">加载中...</div><div style="width:40px;height:4px;background:#e5e7eb;border-radius:2px;margin:0 auto;overflow:hidden"><div style="width:40%;height:100%;background:#10b981;border-radius:2px;animation:loading 1.5s ease-in-out infinite"></div></div></div><style>@keyframes loading{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}</style>';

      async function fetchWithRetry(maxRetries, timeoutMs) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            const r = await fetch('/api/materials', { signal: controller.signal });
            clearTimeout(timeout);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const d = await r.json();
            if (!d.ok) throw new Error('API error');
            return d;
          } catch(e) {
            if (attempt < maxRetries) {
              grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#6b7280"><div style="font-size:14px;margin-bottom:12px">🔄 服务器唤醒中... (' + attempt + '/' + maxRetries + ')</div><div style="width:40px;height:4px;background:#e5e7eb;border-radius:2px;margin:0 auto;overflow:hidden"><div style="width:40%;height:100%;background:#10b981;border-radius:2px;animation:loading 1.5s ease-in-out infinite"></div></div></div>';
              await new Promise(r => setTimeout(r, 2000));
            } else {
              throw e;
            }
          }
        }
      }

      try {
        const d = await fetchWithRetry(4, 30000);
        materials = d.materials;

        // Hide 素材打包 button if no materials have files
        const hasFiles = materials.some(m => m.uploadedFiles && m.uploadedFiles.length > 0);
        const packBtn = document.querySelector('[data-cat="素材打包"]');
        if (packBtn) {
          packBtn.style.display = hasFiles ? '' : 'none';
        }
        renderCards();
      } catch(e) {
        console.error("加载失败:", e);
        document.getElementById('cardGrid').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#ef4444">加载失败，请刷新页面重试<br><small style="color:#9ca3af">'+e.message+'</small></div>';
      }
    }

    function trackDownload(materialId) {
      if (!currentUser) return;
      fetch('/api/download/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, materialId })
      }).catch(() => {});
    }

    async function doDownload(idx, btnEl) {
      if (!currentUser) { openLogin(); return; }
      if (isMobileDevice()) {
        alert('手机设备仅支持预览，无法下载素材');
        return;
      }
      if (btnEl) { btnEl.disabled = true; btnEl.textContent = '准备下载...'; }
      try {
        const r = await fetch('/api/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser.username, materialIndex: idx, deviceId: getDeviceId() })
        });
        const d = await r.json();
        if (!d.ok) {
          alert(d.error || '下载失败');
          if (btnEl) { btnEl.disabled = false; btnEl.textContent = '⬇ 下载素材'; }
          return;
        }
        const files = (d.material.uploadedFiles || []).filter(f => f.ext === '.fla');
        if (files.length > 0) {
          // Use material name as download filename
          const dlName = d.material.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
          // Download each file
          files.forEach((f, i) => {
            setTimeout(() => {
              const a = document.createElement('a');
              a.href = f.path;
              a.download = dlName + f.ext;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }, i * 500);
          });
          if (btnEl) { btnEl.textContent = '✓ 下载 ' + files.length + ' 个文件'; btnEl.disabled = false; }
        } else {
          if (btnEl) { btnEl.textContent = '暂无文件'; btnEl.disabled = false; }
        }
        materials[idx].downloads = (materials[idx].downloads || 0) + 1;
        setTimeout(() => { if (btnEl) btnEl.textContent = '⬇ 下载素材'; }, 2000);
      } catch (e) {
        alert('网络错误，请重试');
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = '⬇ 下载素材'; }
      }
    }

    async function apiAddMaterial(m) {
      const r = await fetch('/api/materials', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...m, username: currentUser.username }) });
      const d = await r.json();
      if (d.ok) { materials = d.materials; renderCards(); }
      return d;
    }

    async function apiUpdateMaterial(idx, m) {
      const r = await fetch('/api/materials/' + idx, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...m, username: currentUser.username }) });
      const d = await r.json();
      if (d.ok) { materials = d.materials; renderCards(); }
      return d;
    }

    async function apiDeleteMaterial(idx) {
      if (!currentUser) { alert('请先登录管理员账号'); return false; }
      try {
        const r = await fetch('/api/materials/' + idx, { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username: currentUser.username }) });
        const d = await r.json();
        if (d.ok) { materials = d.materials; renderCards(); return true; }
        else alert(d.error || '删除失败');
      } catch(e) {
        alert('删除请求失败: ' + e.message);
      }
      return false;
    }

    async function apiAddUser(username, role) {
      const r = await fetch('/api/users', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ adminUsername: currentUser.username, username, role }) });
      return r.json();
    }

    async function apiDeleteUser(username) {
      const r = await fetch('/api/users/' + username, { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ adminUsername: currentUser.username }) });
      return r.json();
    }

    async function apiLoadUsers() {
      const r = await fetch('/api/users?username=' + encodeURIComponent(currentUser.username));
      return r.json();
    }

    async function apiChangePwd(oldPwd, newPwd) {
      const r = await fetch('/api/changePwd', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username: currentUser.username, oldPwd, newPwd }) });
      return r.json();
    }

    async function apiSubmitRequest(content, contact, imageFiles) {
      const formData = new FormData();
      formData.append('username', currentUser ? currentUser.username : '匿名');
      formData.append('content', content);
      formData.append('contact', contact);
      for (const file of imageFiles) {
        formData.append('images', file);
      }
      const r = await fetch('/api/requests', { method:'POST', body: formData });
      return r.json();
    }

    // Request image preview
    let reqSelectedImages = [];
    function previewReqImages(input) {
      const files = Array.from(input.files);
      reqSelectedImages = reqSelectedImages.concat(files).slice(0, 5);
      renderReqImagePreviews();
      input.value = '';
    }
    function renderReqImagePreviews() {
      const container = document.getElementById('reqImgPreview');
      container.innerHTML = reqSelectedImages.map((f, i) =>
        '<div class="preview-item"><img src="'+URL.createObjectURL(f)+'"><button class="remove-img" onclick="removeReqImg('+i+')">✕</button></div>'
      ).join('');
    }
    function removeReqImg(idx) {
      reqSelectedImages.splice(idx, 1);
      renderReqImagePreviews();
    }

    function openRequestModal() {
      document.getElementById('requestModal').classList.add('active');
      document.getElementById('reqContent').value = '';
      document.getElementById('reqContact').value = '';
      document.getElementById('reqMsg').textContent = '';
      reqSelectedImages = [];
      renderReqImagePreviews();
    }

    // ===== NOTIFICATIONS =====
    let notifInterval = null;
    function pollNotifications() {
      if (!currentUser || currentUser.role !== 'admin') return;
      fetch('/api/notifications?username=' + encodeURIComponent(currentUser.username))
        .then(r => r.json())
        .then(d => {
          if (d.ok) {
            const badge = document.getElementById('notifBadge');
            if (d.unread > 0) {
              badge.style.display = 'flex';
              badge.textContent = d.unread > 99 ? '99+' : d.unread;
            } else {
              badge.style.display = 'none';
            }
          }
        }).catch(() => {});
    }

    async function openNotifPanel() {
      const panel = document.getElementById('notifPanel');
      panel.classList.add('open');
      const d = await fetch('/api/notifications?username=' + encodeURIComponent(currentUser.username)).then(r => r.json());
      const list = document.getElementById('notifList');
      if (!d.ok || !d.notifications || d.notifications.length === 0) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:#9ca3af;font-size:13px">暂无通知</div>';
        return;
      }
      list.innerHTML = d.notifications.reverse().map((n, i) =>
        '<div class="notif-item'+(n.read?'':' unread')+'" onclick="markNotifRead('+i+')">'+
          '<div class="notif-from">'+(n.from_user||'系统')+'</div>'+
          '<div class="notif-msg">'+n.message+'</div>'+
          '<div class="notif-time">'+new Date(n.time).toLocaleString('zh-CN')+'</div>'+
        '</div>'
      ).join('');
      // Mark all as read
      await fetch('/api/notifications/read', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username: currentUser.username }) });
      document.getElementById('notifBadge').style.display = 'none';
    }

    function closeNotifPanel() {
      document.getElementById('notifPanel').classList.remove('open');
    }

    function markNotifRead(idx) {
      closeNotifPanel();
    }

    async function apiLoadRequests() {
      const r = await fetch('/api/requests?username=' + encodeURIComponent(currentUser.username));
      return r.json();
    }

    async function apiDeleteRequest(idx) {
      const r = await fetch('/api/requests/' + idx, { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username: currentUser.username }) });
      return r.json();
    }

    // ===== RENDER FUNCTIONS =====
    function getFilteredMaterials() {
      let filtered = materials;
      if (currentCat) {
        if (currentCat === '限时优惠') {
          // Show all materials with '限时' badge
          filtered = filtered.filter(m => (m.badges||[]).includes('限时'));
        } else {
          filtered = filtered.filter(m => m.cat === currentCat);
        }
      }
      if (currentSearch) {
        filtered = filtered.filter(m => m.name.toLowerCase().includes(currentSearch.toLowerCase()));
      }
      return filtered;
    }

    function renderCards() {
      // Keep backend order (newest first by id DESC)
      const filtered = getFilteredMaterials();
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / perPage));
      if (currentPage > totalPages) currentPage = totalPages;
      const start = (currentPage - 1) * perPage;
      const pageItems = filtered.slice(start, start + perPage);

      const grid = document.getElementById('cardGrid');
      grid.innerHTML = '';

      if (pageItems.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#9ca3af">暂无素材</div>';
      }

      pageItems.forEach((m, idx) => {
        const realIdx = materials.indexOf(m);
        const badges = (m.badges||[]).map(b => {
          const cls = b === '版权' ? 'badge-copy' : b === 'new' ? 'badge-new' : b === '限时' ? 'badge-limit' : b === '热门' ? 'badge-hot' : b === 'VIP' ? 'badge-vip' : b === '推荐' ? 'badge-recommend' : b === '免费' ? 'badge-free' : 'badge-limit';
          return '<span class="badge '+cls+'">'+b+'</span>';
        }).join('');

        const files = (m.uploadedFiles||[]).map(f => {
          const ext = (f.ext||'').toLowerCase();
          const cls = ext === '.fla' ? 'file-tag fla' : 'file-tag';
          return '<span class="'+cls+'">'+ext+'</span>';
        }).join('');

        const settingsIcon = (currentUser && currentUser.role === 'admin') ?
          '<div class="card-settings-wrap"><button class="card-settings-btn" data-settings-idx="'+m.id+'" onclick="event.stopPropagation();toggleSettingsById('+m.id+', this)">⚙</button><div class="card-settings-menu" id="settingsMenu'+m.id+'" style="display:none">'+
            '<div class="settings-menu-section"><label class="settings-menu-label">标签</label>'+
            '<div style="display:flex;gap:6px;margin-top:4px">'+
            '<label style="display:flex;align-items:center;gap:2px;font-size:12px;cursor:pointer"><input type="checkbox" class="badge-toggle" data-id="'+m.id+'" data-badge="限时" onchange="event.stopPropagation();toggleBadgeById('+m.id+',\'限时\',this.checked)"'+((m.badges||[]).includes('限时')?' checked':'')+'> <span style="color:#92400e;background:#fef3c7;padding:1px 6px;border-radius:3px;font-size:11px">限时</span></label>'+
            '</div></div>'+
            '<button class="settings-menu-btn delete" onclick="event.stopPropagation();deleteMaterialById('+m.id+')">删除素材</button>'+
          '</div></div>' : '';

        // Check if user can download this material
        let canDownload = false;
        let lockMsg = '登录后下载素材';
        if (currentUser) {
          const role = currentUser.role;
          if (role === 'admin' || role === 'vip') {
            canDownload = true;
          } else if (role === 'promo' && m.cat === '限时优惠') {
            canDownload = true;
          } else if (role === 'user' && m.cat === '表情包') {
            canDownload = true;
          } else if (role === 'user') {
            lockMsg = '仅限表情包（升级后可下载全部素材）';
          } else if (role === 'promo') {
            lockMsg = '仅限限时优惠（升级后可下载全部）';
          }
        }

        const downloadSection = ''; // Removed from cards - download only in preview

        // Get first uploaded image (png/gif/jpg) for card display
        // Use f.ext (always ASCII-safe like .png) instead of f.name (may contain Chinese characters)
        const imgFiles = (m.uploadedFiles||[]).filter(f => /\.(png|gif|jpg|jpeg|webp)$/i.test(f.ext || f.name || ''));
        const vidFiles = (m.uploadedFiles||[]).filter(f => /\.(mp4|webm|mov|avi|mkv)$/i.test(f.ext || f.name || ''));
        let cardImgHtml = '';
        if (imgFiles.length > 0) {
          cardImgHtml = '<img class="card-img-inner" src="'+imgFiles[0].path+'" alt="'+m.name+'" style="object-fit:contain;background:#f9fafb;" oncontextmenu="return false" ondragstart="return false" onerror="this.parentElement.innerHTML=\'<div class=card-img-inner style=background:'+gradients[(m.gradient||0)%gradients.length]+';display:flex;align-items:center;justify-content:center;color:#ef4444;font-size:11px>\u5716\u7247\u8f09\u5165\u5931\u6557: '+imgFiles[0].path+'</div>\'">';
        } else if (vidFiles.length > 0) {
          cardImgHtml = '<video class="card-img-inner" src="'+vidFiles[0].path+'" muted preload="metadata" style="object-fit:contain;background:#000;" oncontextmenu="return false"></video>';
        } else {
          cardImgHtml = '<div class="card-img-inner" style="background:'+gradients[(m.gradient||0) % gradients.length]+'"></div>';
        }

        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = '<div class="card-img"><div class="card-badge">'+badges+'</div>'+cardImgHtml+downloadSection+'</div>'+settingsIcon+'<div class="card-files">'+files+'</div><div class="card-footer"><span class="card-name">'+escapeHtml(m.name)+'</span><span class="card-preview" onclick="event.stopPropagation();openPreview('+realIdx+')">预览 ▶</span></div>';

        card.addEventListener('click', function(e) {
          if (e.target.closest('.card-settings-btn') || e.target.closest('.settings-menu-btn') || e.target.closest('.download-lock-btn') || e.target.closest('.card-preview')) return;
          openPreview(realIdx);
        });
        grid.appendChild(card);
      });

      document.getElementById('pageTotal').textContent = '共 ' + total + ' 条';
      try { renderPagination(totalPages); } catch(e) {}
      try { updateAdminUI(); } catch(e) {}
    }

    function renderPagination(totalPages) {
      const container = document.getElementById('paginationBtns');
      container.innerHTML = '';
      const prevBtn = document.createElement('button');
      prevBtn.className = 'page-btn' + (currentPage <= 1 ? ' disabled' : '');
      prevBtn.textContent = '‹';
      prevBtn.onclick = () => { if (currentPage > 1) { currentPage--; renderCards(); } };
      container.appendChild(prevBtn);
      for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement('button');
        btn.className = 'page-btn' + (i === currentPage ? ' active' : '');
        btn.textContent = i;
        btn.onclick = () => { currentPage = i; renderCards(); };
        container.appendChild(btn);
      }
      if (totalPages > 1) {
        const nextBtn = document.createElement('button');
        nextBtn.className = 'page-btn' + (currentPage >= totalPages ? ' disabled' : '');
        nextBtn.textContent = '›';
        nextBtn.onclick = () => { if (currentPage < totalPages) { currentPage++; renderCards(); } };
        container.appendChild(nextBtn);
      }
    }

    function updateAdminUI() {
      const isAdmin = currentUser && currentUser.role === 'admin';
      document.getElementById('adminPanel').style.display = isAdmin ? 'block' : 'none';
      document.getElementById('adminToolbar').style.display = isAdmin ? 'flex' : 'none';
      document.getElementById('bindBar').style.display = currentUser ? 'flex' : 'none';
      // user list rendered on-demand in openUserManager()
    }

    function updateUserBar() {
      const bar = document.getElementById('userBar');
      const prompt = document.getElementById('loginPrompt');
      const notifBtn = document.getElementById('notifBtn');
      if (currentUser) {
        bar.style.display = 'flex';
        prompt.style.display = 'none';
        // Show notification button for admin
        if (currentUser.role === 'admin') {
          notifBtn.style.display = 'inline-flex';
          pollNotifications();
        } else {
          notifBtn.style.display = 'none';
        }
        const roleLabels = { admin:'管理员', vip:'VIP', promo:'限时优惠', user:'普通用户' };
        document.getElementById('userDisplayName').textContent = currentUser.username;
        const roleBadge = document.getElementById('userRoleBadge');
        roleBadge.textContent = roleLabels[currentUser.role] || currentUser.role;
        roleBadge.className = 'user-role ' + currentUser.role;
      } else {
        bar.style.display = 'none';
        prompt.style.display = 'flex';
        notifBtn.style.display = 'none';
      }
    }

    function openChangePwd() {
      document.getElementById('changePwdModal').classList.add('active');
      document.getElementById('changePwdMsg').textContent = '';
      document.getElementById('oldPwd').value = '';
      document.getElementById('newPwd').value = '';
      document.getElementById('confirmPwd').value = '';
    }

    async function revertToStable() {
      if (!confirm('⚠️ 确定要恢复到稳定版本吗？\n\n这会从 R2 备份恢复数据库，当前未保存的变更可能会丢失。')) {
        return;
      }
      const btn = document.getElementById('revertStableBtn');
      const msg = document.getElementById('revertMsg');
      btn.disabled = true;
      btn.textContent = '恢复中...';
      msg.textContent = '正在从 R2 恢复备份数据库...';
      msg.style.color = '#059669';
      
      try {
        const r = await fetch('/api/revert-stable', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ username: currentUser.username })
        });
        const d = await r.json();
        if (d.ok) {
          msg.textContent = '✅ 恢复成功！已恢复 ' + d.materialCount + ' 个素材。页面将在 3 秒后重新加载...';
          msg.style.color = '#059669';
          setTimeout(() => location.reload(), 3000);
        } else {
          msg.textContent = '❌ 恢复失败: ' + d.error;
          msg.style.color = '#dc2626';
          btn.disabled = false;
          btn.textContent = '⚠️ 恢复到稳定版本';
        }
      } catch (e) {
        msg.textContent = '❌ 请求失败: ' + e.message;
        msg.style.color = '#dc2626';
        btn.disabled = false;
        btn.textContent = '⚠️ 恢复到稳定版本';
      }
    }
    
    function doLogout() {
      currentUser = null;
      try { localStorage.removeItem('lz_user'); } catch(e) {}
      updateUserBar();
      renderCards();
    }

    async function renderAdminUsers() {
      const list = document.getElementById('adminUserList');
      if (!list || !currentUser || currentUser.role !== 'admin') return;
      const d = await apiLoadUsers();
      if (!d.ok) { list.innerHTML = '<span style="color:red">加载失败</span>'; return; }
      list.innerHTML = '<div style="margin-top:12px;font-weight:500">用户列表：</div>' +
        d.users.map(u => '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border:1px solid #e5e7eb;border-radius:4px;margin-top:4px"><span>'+u.username+' <span style="color:#6b7280;font-size:11px">('+u.role+')</span></span>' +
        (u.username !== 'admin' ? '<button onclick="handleDeleteUser(\''+u.username+'\')" style="background:#ef4444;color:#fff;border:none;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:12px">删除</button>' : '<span style="font-size:11px;color:#6b7280">管理员</span>') + '</div>').join('');
    }

    async function renderRequests() {
      const panel = document.getElementById('requestPanel');
      const list = document.getElementById('requestList');
      if (!panel || !list) return;
      const d = await apiLoadRequests();
      if (!d.ok || !d.requests || d.requests.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af">暂无需求</div>';
        return;
      }
      list.innerHTML = d.requests.map((r, i) => {
        let html = '<div class="request-item"><div class="req-header"><span style="font-weight:500;font-size:13px">'+escapeHtml(r.user)+'</span><span class="req-time">'+r.time+'</span></div>';
        html += '<div class="req-content">'+escapeHtml(r.content)+'</div>';
        if (r.contact) html += '<div style="margin-top:4px;font-size:12px;color:#6b7280">联络方式：'+escapeHtml(r.contact)+'</div>';
        if (r.images && r.images.length > 0) {
          html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">';
          r.images.forEach(img => { html += '<img src="'+escapeHtml(img)+'" style="width:60px;height:60px;object-fit:cover;border-radius:4px;cursor:pointer" onclick="window.open(this.src)">'; });
          html += '</div>';
        }
        html += (currentUser && currentUser.role === 'admin' ? '<button onclick="handleDeleteRequest('+r.id+')" style="margin-top:8px;background:#ef4444;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px">删除</button>' : '') + '</div>';
        return html;
      }).join('');
    }

    // ===== MODAL FUNCTIONS =====
    function openLogin() {
      document.getElementById('loginModal').classList.add('active');
      document.getElementById('loginMsg').textContent = '';
      document.getElementById('loginUser').value = '';
      document.getElementById('loginPass').value = '';
    }

    function toggleSettings(idx, btn) {
      const menu = document.getElementById('settingsMenu'+idx);
      // Close all other menus
      document.querySelectorAll('.card-settings-menu').forEach(m => {
        if (m !== menu) m.style.display = 'none';
      });
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }

    // ID-based versions (more robust after sorting)
    function toggleSettingsById(id, btn) {
      const menu = document.getElementById('settingsMenu'+id);
      document.querySelectorAll('.card-settings-menu').forEach(m => {
        if (m !== menu) m.style.display = 'none';
      });
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
    function toggleBadgeById(id, badge, checked) {
      const m = materials.find(x => x.id === id);
      if (!m) return;
      if (!m.badges) m.badges = [];
      if (checked) { if (!m.badges.includes(badge)) m.badges.push(badge); }
      else { m.badges = m.badges.filter(b => b !== badge); }
      fetch('/api/materials/'+id, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username: currentUser.username, badges: m.badges }) }).catch(()=>{});
      renderCards();
    }
    function deleteMaterialById(id) {
      if (!currentUser) { alert('请先登录管理员账号'); return; }
      const m = materials.find(x => x.id === id);
      if (!m) { alert('素材不存在'); return; }
      if (!confirm('确定删除「'+m.name+'」？')) return;
      fetch('/api/materials/'+id, { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username: currentUser.username }) })
        .then(r=>r.json()).then(d => {
          if (d.ok) { materials = d.materials; renderCards(); closeAllSettingsMenus(); }
          else alert(d.error || '删除失败');
        }).catch(e => alert('删除请求失败: '+e.message));
    }

    function openEditMaterial(idx) {
      const m = materials[idx];
      document.getElementById('editModalTitle').textContent = '编辑素材';
      document.getElementById('editName').value = m.name;
      document.getElementById('editCat').value = m.cat;
      document.getElementById('editBadgeLimit').checked = (m.badges||[]).includes('限时');
      document.getElementById('editIndex').value = idx;
      document.getElementById('editMsg').textContent = '';
      // Track existing files (with path) vs new files (without path)
      editSelectedFiles = (m.uploadedFiles || []).map(f => ({
        name: f.name,
        size: f.size,
        path: f.path,
        _existing: true
      }));
      renderEditFileList();
      closeAllSettingsMenus();
      openEditModal();
    }

    async function deleteMaterial(idx) {
      if (!currentUser) { alert('请先登录管理员账号'); return; }
      const m = materials[idx];
      if (!m) { alert('素材不存在'); return; }
      if (!confirm('确定删除「'+m.name+'」？')) return;
      try {
        const r = await fetch('/api/materials/'+m.id, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser.username })
        });
        const d = await r.json();
        if (d.ok) { materials = d.materials; renderCards(); closeAllSettingsMenus(); }
        else alert(d.error || '删除失败');
      } catch(e) {
        alert('删除请求失败: ' + e.message);
      }
    }

    async function changeCat(idx, newCat) {
      materials[idx].cat = newCat;
      // Save to server
      try {
        await fetch('/api/materials/'+materials[idx].id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser.username, cat: newCat })
        });
      } catch(e) {}
      // Don't call renderCards() here - it destroys all open settings menus
      // The dropdown already shows the new value, no visual update needed
    }

    async function toggleBadge(idx, badge, checked) {
      const m = materials[idx];
      if (!m.badges) m.badges = [];
      if (checked) {
        if (!m.badges.includes(badge)) m.badges.push(badge);
      } else {
        m.badges = m.badges.filter(b => b !== badge);
      }
      try {
        await fetch('/api/materials/'+m.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser.username, badges: m.badges.join(',') })
        });
      } catch(e) {}
      renderCards();
    }

    async function moveMaterial(idx, direction) {
      // Sort first to get current display order
      materials.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= materials.length) return;

      // Swap
      const temp = materials[idx];
      materials[idx] = materials[newIdx];
      materials[newIdx] = temp;

      // Update sortOrder
      materials.forEach((m, i) => m.sortOrder = i);

      // Save to server
      try {
        const order = materials.map((_, i) => i);
        await fetch('/api/materials/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser.username, order })
        });
      } catch(e) {}

      closeAllSettingsMenus();
      renderCards();
    }

    function closeAllSettingsMenus() {
      document.querySelectorAll('.card-settings-menu').forEach(m => m.style.display = 'none');
    }

    // ===== BINDING FUNCTIONS =====
    function openBindModal() {
      if (!currentUser) { openLogin(); return; }
      document.getElementById('bindPlatform').value = '抖音';
      document.getElementById('bindAccount').value = '';
      document.getElementById('bindMsg').textContent = '';
      document.getElementById('bindModal').classList.add('active');
    }

    async function openMyBindings() {
      if (!currentUser) { openLogin(); return; }
      const r = await fetch('/api/bindings?username=' + encodeURIComponent(currentUser.username));
      const d = await r.json();
      const list = document.getElementById('myBindingsList');
      if (!d.ok || !d.bindings || d.bindings.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af">暂无绑定</div>';
      } else {
        list.innerHTML = d.bindings.map(b =>
          '<div class="bind-item">'+
            '<div><span class="bind-platform">'+b.platform+'</span><span class="bind-account">'+b.platformAccount+'</span>'+
            '<div class="bind-time">绑定时间: '+new Date(b.bindTime).toLocaleString('zh-CN')+'</div></div>'+
            '<button class="bind-unbind-btn" onclick="unbindPlatform(\''+b.platform+'\')">解绑</button>'+
          '</div>'
        ).join('');
      }
      document.getElementById('myBindingsModal').classList.add('active');
    }

    async function unbindPlatform(platform) {
      const r = await fetch('/api/bindings/' + encodeURIComponent(platform), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username })
      });
      const d = await r.json();
      if (d.ok) {
        openMyBindings(); // Refresh
      } else {
        alert(d.error || '解绑失败');
      }
    }

    async function openAllBindings() {
      const r = await fetch('/api/bindings/all?username=' + encodeURIComponent(currentUser.username));
      const d = await r.json();
      const list = document.getElementById('allBindingsList');
      if (!d.ok || !d.users) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af">无权限</div>';
      } else {
        list.innerHTML = d.users.filter(u => u.bindings && u.bindings.length > 0).map(u =>
          '<div class="all-bind-user">'+
            '<div class="bind-user-name">'+escapeHtml(u.username)+' <span style="font-weight:400;color:#9ca3ae;font-size:11px">('+escapeHtml(u.role)+')</span></div>'+
            '<div class="bind-user-bindings">'+u.bindings.map(b => escapeHtml(b.platform)+'('+escapeHtml(b.platformAccount)+')').join('、')+'</div>'+
          '</div>'
        ).join('') || '<div style="text-align:center;padding:20px;color:#9ca3af">暂无绑定</div>';
      }
      document.getElementById('allBindingsModal').classList.add('active');
    }

    document.getElementById('bindSubmit').addEventListener('click', async function() {
      const platform = document.getElementById('bindPlatform').value;
      const account = document.getElementById('bindAccount').value.trim();
      const msg = document.getElementById('bindMsg');
      if (!account) { msg.textContent = '请输入平台账号'; msg.className = 'modal-msg error'; return; }

      this.disabled = true;
      this.textContent = '绑定中...';
      try {
        const r = await fetch('/api/bindings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser.username, platform, platformAccount: account })
        });
        const d = await r.json();
        if (d.ok) {
          msg.textContent = '绑定成功！';
          msg.className = 'modal-msg';
          setTimeout(() => { document.getElementById('bindModal').classList.remove('active'); }, 500);
        } else {
          msg.textContent = d.error || '绑定失败';
          msg.className = 'modal-msg error';
        }
      } catch(e) {
        msg.textContent = '网络错误';
        msg.className = 'modal-msg error';
      } finally {
        this.disabled = false;
        this.textContent = '绑定';
      }
    });

    // ===== EVENT LISTENERS =====
    // Close settings menu when clicking outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.card-settings-wrap')) {
        closeAllSettingsMenus();
      }
    });

    function openEditModal() {
      // Close other modals first, then open edit modal
      document.querySelectorAll('.modal-overlay').forEach(m => {
        if (m.id !== 'editModal') m.classList.remove('active');
      });
      document.getElementById('editModal').classList.add('active');
    }

    function openPreview(idx) {
      const m = materials[idx];
      if (!m) return;
      document.getElementById('previewTitle').textContent = m.name;

      const previewEl = document.getElementById('previewMainImg');
      const thumbs = document.getElementById('previewThumbs');
      const files = document.getElementById('previewFiles');
      const dlArea = document.getElementById('previewDlArea');

      // Everyone can preview images, only logged-in users can download
      // Use f.ext (always ASCII-safe like .png) instead of f.name (may contain Chinese characters)
      const imgFiles = (m.uploadedFiles||[]).filter(f => /\.(png|gif|jpg|jpeg|webp)$/i.test(f.ext || f.name || ''));
      const vidFiles = (m.uploadedFiles||[]).filter(f => /\.(mp4|webm|mov|avi|mkv)$/i.test(f.ext || f.name || ''));

      if (imgFiles.length > 0) {
        previewEl.innerHTML = '<img src="'+imgFiles[0].path+'" alt="'+m.name+'" style="max-width:100%;max-height:60vh;object-fit:contain;" oncontextmenu="return false" ondragstart="return false">';
        previewEl.style.background = 'none';
      } else if (vidFiles.length > 0) {
        previewEl.innerHTML = '<video src="'+vidFiles[0].path+'" controls playsinline preload="metadata" style="max-width:100%;max-height:60vh;object-fit:contain;background:#000;" oncontextmenu="return false"></video>';
        previewEl.style.background = '#000';
      } else {
        previewEl.innerHTML = '';
        previewEl.style.background = gradients[(m.gradient||0) % gradients.length];
      }

      thumbs.innerHTML = '';
      if (imgFiles.length > 0) {
        imgFiles.forEach((img, i) => {
          const t = document.createElement('div');
          t.className = 'preview-thumb' + (i === 0 ? ' active' : '');
          t.style.backgroundImage = 'url('+img.path+')';
          t.style.backgroundSize = 'cover';
          t.style.backgroundPosition = 'center';
          t.style.backgroundRepeat = 'no-repeat';
          t.onclick = function() {
            document.querySelectorAll('.preview-thumb').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            previewEl.innerHTML = '<img src="'+img.path+'" alt="'+m.name+'" style="max-width:100%;max-height:60vh;object-fit:contain;" oncontextmenu="return false" ondragstart="return false">';
            previewEl.style.background = 'none';
          };
          thumbs.appendChild(t);
        });
      } else if (vidFiles.length > 0) {
        vidFiles.forEach((vid, i) => {
          const t = document.createElement('div');
          t.className = 'preview-thumb' + (i === 0 ? ' active' : '');
          t.style.background = '#000';
          t.innerHTML = '<video src="'+vid.path+'" muted preload="metadata" style="width:100%;height:100%;object-fit:contain;"></video>';
          t.onclick = function() {
            document.querySelectorAll('.preview-thumb').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            previewEl.innerHTML = '<video src="'+vid.path+'" controls playsinline preload="metadata" style="max-width:100%;max-height:60vh;object-fit:contain;background:#000;" oncontextmenu="return false"></video>';
            previewEl.style.background = '#000';
          };
          thumbs.appendChild(t);
        });
      } else {
        for (let i = 0; i < 3; i++) {
          const t = document.createElement('div');
          t.className = 'preview-thumb' + (i === 0 ? ' active' : '');
          t.style.background = gradients[((m.gradient||0) + i) % gradients.length];
          t.onclick = function() {
            document.querySelectorAll('.preview-thumb').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            previewEl.style.background = gradients[((m.gradient||0) + i) % gradients.length];
          };
          thumbs.appendChild(t);
        }
      }
      files.innerHTML = '';

      // Download section - only for logged-in users
      if (!currentUser) {
        dlArea.innerHTML = '<div class="locked-msg">请登录后下载素材 <button onclick="closePreview();openLogin()" style="background:none;border:none;color:#10b981;cursor:pointer;font-size:13px;margin-left:8px">立即登录</button></div>';
      } else {
        const role = currentUser.role;
        let canDl = false;
        let lockText = '';
        if (role === 'admin' || role === 'vip') canDl = true;
        else if (role === 'promo' && m.cat === '限时优惠') canDl = true;
        else if (role === 'user' && m.cat === '表情包') canDl = true;
        else if (role === 'user') lockText = '仅限表情包（升级后可下载全部素材）';
        else if (role === 'promo') lockText = '仅限限时优惠（升级后可下载全部）';

        if (canDl) {
          const uploadedFiles = (m.uploadedFiles || []).filter(f => f.ext === '.fla');
          let filesHtml = '';
          if (uploadedFiles.length > 0) {
            filesHtml = '<div class="download-files-list">' +
              uploadedFiles.map((f, i) => '<a class="dl-file-btn" href="'+f.path+'" download="'+f.name+'" onclick="event.stopPropagation();trackDownload('+m.id+')">⬇ FLA文件</a>').join('') +
            '</div>';
          } else {
            filesHtml = '<div style="font-size:12px;color:#9ca3af;margin-bottom:8px">暂无FLA文件</div>';
          }
          dlArea.innerHTML = filesHtml;
        } else {
          dlArea.innerHTML = '<div class="locked-msg">🔒 '+lockText+'</div>';
        }
      }
      document.getElementById('previewOverlay').classList.add('active');
    }

    function closePreview() {
      document.getElementById('previewOverlay').classList.remove('active');
    }

    function showPackPanel() {
      const overlay = document.getElementById('packOverlay');
      const panel = document.getElementById('packPanel');
      
      overlay.style.display = 'block';
      panel.style.display = 'block';
      overlay.onclick = closePackPanel;
      
      panel.innerHTML = '<h3>选择要下载的分类</h3>' + 
        '<p style="color: #666; font-size: 14px; margin: 10px 0 20px 0;">⏳ 打包需要一些时间，请耐心等待</p>';

      const categories = ['人物', '表情包', '背景图', '道具栏'];
      categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'pack-category-btn';
        btn.textContent = cat + ' 素材';
        btn.onclick = (e) => {
          e.stopPropagation();
          downloadCategory(cat, btn);
        };
        panel.appendChild(btn);
      });

      const allBtn = document.createElement('button');
      allBtn.className = 'pack-category-btn';
      allBtn.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
      allBtn.textContent = '全部打包下载';
      allBtn.onclick = (e) => {
        e.stopPropagation();
        downloadAllMaterials(allBtn);
      };
      panel.appendChild(allBtn);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'pack-close-btn';
      closeBtn.textContent = '关闭';
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        closePackPanel();
      };
      panel.appendChild(closeBtn);
      document.body.appendChild(panel);
    }

    function closePackPanel() {
      const overlay = document.getElementById('packOverlay');
      const panel = document.getElementById('packPanel');
      if (overlay) overlay.style.display = 'none';
      if (panel) panel.style.display = 'none';
    }
    function downloadCategory(category, btn) {
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = category + ' 打包中...';

      fetch('/api/download-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUser.username,
          deviceId: getDeviceId(),
          isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
          category: category
        })
      })
      .then(response => {
        if (!response.ok) {
          return response.json().then(err => { throw new Error(err.error || '下载失败'); });
        }
        return response.blob();
      })
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lizi-materials-' + category + '.zip';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      })
      .catch(err => {
        alert('下载失败: ' + err.message);
      })
      .finally(() => {
        btn.disabled = false;
        btn.textContent = originalText;
      });
    }

    function downloadAllMaterials(btn) {
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '全部打包中...';

      fetch('/api/download-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUser.username,
          deviceId: getDeviceId(),
          isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
        })
      })
      .then(response => {
        if (!response.ok) {
          return response.json().then(err => { throw new Error(err.error || '下载失败'); });
        }
        return response.blob();
      })
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lizi-materials-all.zip';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      })
      .catch(err => {
        alert('下载失败: ' + err.message);
      })
      .finally(() => {
        btn.disabled = false;
        btn.textContent = originalText;
      });
    }

    // ===== EVENT LISTENERS =====
    document.getElementById('categories').addEventListener('click', function(e) {
      const btn = e.target.closest('.cat-btn');
      if (!btn) return;
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Handle 素材打包 button
      if (btn.dataset.cat === '素材打包') {
        if (!currentUser) {
          alert('请先登录后再使用素材打包功能');
          currentCat = '人物';
          document.querySelectorAll('.cat-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.cat === '人物');
          });
          renderCards();
          return;
        }
        const canDownload = currentUser.role === 'admin' || currentUser.role === 'vip';
        if (!canDownload) {
          alert('权限不足，仅管理员或VIP可使用素材打包功能');
          currentCat = '人物';
          document.querySelectorAll('.cat-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.cat === '人物');
          });
          renderCards();
          return;
        }
        showPackPanel();
        return;
      }
      currentCat = btn.dataset.cat;
      currentPage = 1;
      // Update URL for SEO-friendly routing
      const catPath = '/cat/' + encodeURIComponent(currentCat);
      history.pushState({ cat: currentCat }, '', catPath);
      // Update canonical and OG tags dynamically
      updateSEOTags(currentCat);
      renderCards();
    });

    // Handle browser back/forward navigation
    window.addEventListener('popstate', function(e) {
      if (e.state && e.state.cat) {
        switchCatFromURL(e.state.cat);
      } else {
        // Check URL path
        const match = window.location.pathname.match(/^\/cat\/(.+)$/);
        if (match) {
          switchCatFromURL(decodeURIComponent(match[1]));
        } else {
          switchCatFromURL('人物');
        }
      }
    });

    function switchCatFromURL(cat) {
      currentCat = cat;
      currentPage = 1;
      document.querySelectorAll('.cat-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.cat === cat);
      });
      updateSEOTags(cat);
      renderCards();
    }

    function updateSEOTags(cat) {
      const catDescriptions = {
        '人物': '人物立绘素材，包含FLA源文件',
        '表情包': '表情包素材下载，提供丰富的表情动画FLA源文件',
        '画师寄售': '画师寄售素材，独家原创美术资源',
        '背景图': '背景图素材，精美场景背景FLA源文件',
        '道具栏': '道具栏素材，游戏道具图标FLA源文件',
        '特效': '特效素材，动画特效FLA源文件',
        '限时优惠': '限时优惠素材，特价优质美术资源'
      };
      const desc = catDescriptions[cat] || '专业美术素材下载平台';
      const pageTitle = cat === '人物' ? '栗子素材网 - 专业美术素材下载平台' : cat + '素材 - 栗子素材网';
      document.title = pageTitle;
      // Update canonical
      let canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) canonical.href = window.location.origin + '/cat/' + encodeURIComponent(cat);
      // Update OG tags
      let ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) ogTitle.content = pageTitle;
      let ogUrl = document.querySelector('meta[property="og:url"]');
      if (ogUrl) ogUrl.content = window.location.origin + '/cat/' + encodeURIComponent(cat);
      let ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) ogDesc.content = desc;
    }

    document.getElementById('searchBtn').addEventListener('click', function() {
      currentSearch = document.getElementById('searchInput').value.trim();
      currentPage = 1;
      renderCards();
    });
    document.getElementById('searchInput').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') { currentSearch = this.value.trim(); currentPage = 1; renderCards(); }
    });

    // Real-time search with debounce (#7 optimization)
    let _searchDebounce = null;
    document.getElementById('searchInput').addEventListener('input', function() {
      clearTimeout(_searchDebounce);
      const val = this.value.trim();
      _searchDebounce = setTimeout(() => {
        currentSearch = val;
        currentPage = 1;
        renderCards();
      }, 300);
    });

    // WeChat floating button (#6 optimization)
    document.getElementById('wechatFab').addEventListener('click', function() {
      document.getElementById('wechatFabModal').classList.add('active');
    });
    document.getElementById('wechatFabModal').addEventListener('click', function(e) {
      if (e.target === this) this.classList.remove('active');
    });

    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', function() {
        const id = this.dataset.close;
        if (id) document.getElementById(id).classList.remove('active');
      });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', function(e) {
        if (e.target === this) this.classList.remove('active');
      });
    });

    document.getElementById('previewClose').addEventListener('click', closePreview);

    // Login
    document.getElementById('loginSubmit').addEventListener('click', async function() {
      const username = document.getElementById('loginUser').value.trim();
      const password = document.getElementById('loginPass').value.trim();
      const msg = document.getElementById('loginMsg');
      if (!username || !password) { msg.textContent = '请输入用户名和密码'; msg.className = 'modal-msg error'; return; }
      let d = await apiLogin(username, password);
      // If server rejects password, check localStorage fallback
      if (!d.ok) {
        try {
          const saved = JSON.parse(localStorage.getItem('lz_passwords') || '{}');
          if (saved[username] && saved[username] === password) {
            d = { ok: true, user: { username, role: 'user' } };
          }
        } catch(e) {}
      }
      if (!d.ok) { msg.textContent = d.error || '登录失败'; msg.className = 'modal-msg error'; return; }
      currentUser = d.user;
      try { localStorage.setItem('lz_user', JSON.stringify(currentUser)); } catch(e) {}
      msg.textContent = '登录成功！';
      msg.className = 'modal-msg';
      updateUserBar();
      setTimeout(() => {
        document.getElementById('loginModal').classList.remove('active');
        renderCards();
      }, 500);
    });

    // Add user
    document.getElementById('addUserBtn').addEventListener('click', async function() {
      if (!currentUser || currentUser.role !== 'admin') return;
      const username = document.getElementById('adminNewUser').value.trim();
      const role = document.getElementById('adminNewRole').value;
      const msg = document.getElementById('adminMsg');
      if (!username) { msg.textContent = '请输入用户名'; msg.style.color = '#ef4444'; return; }
      const d = await apiAddUser(username, role);
      if (!d.ok) { msg.textContent = d.error; msg.style.color = '#ef4444'; return; }
      msg.textContent = '用户 "'+username+'" 已创建，默认密码 123456';
      msg.style.color = '#10b981';
      document.getElementById('adminNewUser').value = '';
      renderAdminUsers();
    });

    async function handleDeleteUser(username) {
      if (!confirm('确定删除用户 "'+username+'"？')) return;
      const d = await apiDeleteUser(username);
      if (d.ok) renderAdminUsers();
      else alert(d.error);
    }

    async function handleDeleteRequest(idx) {
      const d = await apiDeleteRequest(idx);
      if (d.ok) renderRequests();
    }

    // Change password
    document.getElementById('changePwdSubmit').addEventListener('click', async function() {
      const oldPwd = document.getElementById('oldPwd').value;
      const newPwd = document.getElementById('newPwd').value;
      const confirmPwd = document.getElementById('confirmPwd').value;
      const msg = document.getElementById('changePwdMsg');
      if (!oldPwd) { msg.textContent = '请输入当前密码'; msg.className = 'modal-msg error'; return; }
      if (!newPwd) { msg.textContent = '请输入新密码'; msg.className = 'modal-msg error'; return; }
      if (newPwd !== confirmPwd) { msg.textContent = '两次密码不一致'; msg.className = 'modal-msg error'; return; }
      const d = await apiChangePwd(oldPwd, newPwd);
      if (!d.ok) { msg.textContent = d.error; msg.className = 'modal-msg error'; return; }
      // Save new password to localStorage as fallback
      try {
        const saved = JSON.parse(localStorage.getItem('lz_passwords') || '{}');
        saved[currentUser.username] = newPwd;
        localStorage.setItem('lz_passwords', JSON.stringify(saved));
      } catch(e) {}
      msg.textContent = '密码修改成功！';
      msg.className = 'modal-msg';
      setTimeout(() => { document.getElementById('changePwdModal').classList.remove('active'); }, 500);
    });

    // Submit request
    document.getElementById('reqSubmit').addEventListener('click', async function() {
      const content = document.getElementById('reqContent').value.trim();
      const contact = document.getElementById('reqContact').value.trim();
      const msg = document.getElementById('reqMsg');
      if (!content) { msg.textContent = '请输入需求描述'; msg.className = 'modal-msg error'; return; }
      this.disabled = true;
      this.textContent = '提交中...';
      try {
        const d = await apiSubmitRequest(content, contact, reqSelectedImages);
        if (!d.ok) { msg.textContent = d.error; msg.className = 'modal-msg error'; return; }
        msg.textContent = '需求已提交！';
        msg.className = 'modal-msg';
        reqSelectedImages = [];
        renderReqImagePreviews();
        setTimeout(() => { document.getElementById('requestModal').classList.remove('active'); }, 800);
      } catch(e) {
        msg.textContent = '网络错误'; msg.className = 'modal-msg error';
      } finally {
        this.disabled = false;
        this.textContent = '提交';
      }
    });

    // Add material
    // File handling for edit modal
    let editSelectedFiles = [];
    function previewEditFiles(input) {
      const files = Array.from(input.files);
      editSelectedFiles = editSelectedFiles.concat(files);
      input.value = '';
      renderEditFileList();
    }

    // Watermark disabled — no longer applied to uploaded images
    async function addWatermarkToImages() {
      // disabled
    }

    function loadImageFile(file) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
    }
    function renderEditFileList() {
      const container = document.getElementById('editFileList');
      container.innerHTML = editSelectedFiles.map((f, i) =>
        '<div class="edit-file-item"><span>'+f.name+' <span class="file-size">'+formatSize(f.size)+'</span></span><button class="remove-file" onclick="removeEditFile('+i+')">删除</button></div>'
      ).join('');
    }
    function removeEditFile(idx) {
      editSelectedFiles.splice(idx, 1);
      renderEditFileList();
    }
    function formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
      return (bytes/(1024*1024)).toFixed(1) + ' MB';
    }
    function pathExt(filename) {
      const idx = filename.lastIndexOf('.');
      return idx === -1 ? '' : filename.substring(idx);
    }

    // API for adding material with files
    async function apiAddMaterialWithFiles(formData) {
      const r = await fetch('/api/materials', { method:'POST', body: formData });
      const d = await r.json();
      if (d.ok) { materials = d.materials; renderCards(); }
      return d;
    }

    // API for uploading files to existing material
    async function apiUploadMaterialFiles(idx, formData) {
      const r = await fetch('/api/materials/' + idx + '/upload', { method:'POST', body: formData });
      const d = await r.json();
      if (d.ok) { materials[idx] = d.material; renderCards(); }
      return d;
    }

    document.getElementById('addMaterialBtn').addEventListener('click', function() {
      if (!currentUser || currentUser.role !== 'admin') return;
      document.getElementById('editModalTitle').textContent = '新增素材';
      document.getElementById('editName').value = '';
      document.getElementById('editCat').value = '表情包';
      document.getElementById('editBadgeLimit').checked = false;
      document.getElementById('editBadgeHot').checked = false;
      document.getElementById('editBadgeVip').checked = false;
      document.getElementById('editBadgeRecommend').checked = false;
      document.getElementById('editBadgeFree').checked = false;
      document.getElementById('editIndex').value = '';
      document.getElementById('editMsg').textContent = '';
      editSelectedFiles = [];
      renderEditFileList();
      document.getElementById('editModal').classList.add('active');
    });

    // Batch upload
    let batchSelectedFiles = [];
    function previewBatchFiles(input) {
      batchSelectedFiles = Array.from(input.files);
      const container = document.getElementById('batchFileList');
      if (batchSelectedFiles.length === 0) { container.innerHTML = ''; return; }
      container.innerHTML = batchSelectedFiles.map((f, i) =>
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:#f9fafb;border-radius:4px;margin-bottom:2px;font-size:12px">'+
          '<span>'+(i+1)+'. '+f.name+'</span><span style="color:#9ca3af">'+formatSize(f.size)+'</span>'+
        '</div>'
      ).join('');
    }

    document.getElementById('batchAddBtn').addEventListener('click', function() {
      if (!currentUser || currentUser.role !== 'admin') return;
      batchSelectedFiles = [];
      document.getElementById('batchFileList').innerHTML = '';
      document.getElementById('batchFileInput').value = '';
      document.getElementById('batchMsg').textContent = '';
      document.getElementById('batchMsg').className = 'modal-msg';
      document.getElementById('batchModal').classList.add('active');
    });

    document.getElementById('batchSubmit').addEventListener('click', async function() {
      if (!currentUser || currentUser.role !== 'admin') return;
      if (batchSelectedFiles.length === 0) {
        document.getElementById('batchMsg').textContent = '请选择文件';
        document.getElementById('batchMsg').className = 'modal-msg error';
        return;
      }

      this.disabled = true;
      this.textContent = '上传中...';

      // Group files by name (without extension)
      const groups = {};
      batchSelectedFiles.forEach(f => {
        const nameWithoutExt = f.name.replace(/\.[^.]+$/, '');
        const ext = pathExt(f.name);
        if (!groups[nameWithoutExt]) groups[nameWithoutExt] = [];
        groups[nameWithoutExt].push({ file: f, ext });
      });

      const cat = document.getElementById('batchCat').value;
      const badges = ['版权'];
      if (document.getElementById('batchBadgeNew').checked) badges.push('new');
      if (document.getElementById('batchBadgeLimit').checked) badges.push('限时');
      if (document.getElementById('batchBadgeHot').checked) badges.push('热门');
      if (document.getElementById('batchBadgeVip').checked) badges.push('VIP');

      const total = Object.keys(groups).length;
      let success = 0;
      let fail = 0;
      let skipped = 0;
      let renamed = 0;
      const errors = [];
      const warnings = [];

      for (const [name, files] of Object.entries(groups)) {
        try {
          let finalName = toSimplified(name);
          const formData = new FormData();
          formData.append('username', currentUser.username);
          formData.append('cat', cat);
          formData.append('badges', badges.join(','));
          files.forEach(f => formData.append('files', f.file));

          // First try to upload
          formData.append('name', finalName);
          const r = await fetch('/api/materials', { method: 'POST', body: formData });
          const d = await r.json();
          
          if (d.ok) { 
            success++;
            if (d.warning) warnings.push(finalName + ': ' + d.warning);
          } else if (d.error === 'duplicate') {
            // Auto-rename duplicate by appending a random suffix
            renamed++;
            const suffix = '_' + Math.round(Math.random() * 1000);
            formData.set('name', finalName + suffix);
            const r2 = await fetch('/api/materials', { method: 'POST', body: formData });
            const d2 = await r2.json();
            if (d2.ok) { 
              success++;
              if (d2.warning) warnings.push(finalName + suffix + ': ' + d2.warning);
            }
            else { fail++; errors.push(name + ': ' + d2.error); }
          } else { 
            fail++; errors.push(name + ': ' + d.error); 
          }
        } catch(e) {
          fail++;
          errors.push(name + ': 网络错误');
        }
        // Update progress
        this.textContent = '上传中... ' + (success + fail + renamed) + '/' + total;
      }

      if (success > 0) {
        let msg = '成功上传 ' + success + ' 个素材';
        if (renamed > 0) msg += '（其中 ' + renamed + ' 个名称重复已自动改名）';
        if (fail > 0) msg += '，' + fail + ' 个失败';
        if (warnings.length > 0) {
          msg += '\n\n⚠️ 以下素材文件不完整：\n' + warnings.join('\n');
        }
        document.getElementById('batchMsg').textContent = msg;
        document.getElementById('batchMsg').className = 'modal-msg';
        materials = (await fetch('/api/materials').then(r => r.json())).materials;
        renderCards();
        setTimeout(() => { document.getElementById('batchModal').classList.remove('active'); }, warnings.length > 0 ? 5000 : 1500);
      } else {
        document.getElementById('batchMsg').textContent = '上传失败：' + errors.join('; ');
        document.getElementById('batchMsg').className = 'modal-msg error';
      }

      this.disabled = false;
      this.textContent = '批量上传';
    });

    // Edit mode toggle
    

    // View requests
    // View bindings
    document.getElementById('viewBindingsBtn').addEventListener('click', function() {
      openAllBindings();
    });

    document.getElementById('viewReqBtn').addEventListener('click', function() {
      const panel = document.getElementById('requestPanel');
      if (panel.style.display === 'none') {
        panel.style.display = 'block';
        renderRequests();
      } else {
        panel.style.display = 'none';
      }
    });

    // Save material
    document.getElementById('editSubmit').addEventListener('click', async function() {
      if (!currentUser || currentUser.role !== 'admin') return;
      let name = toSimplified(document.getElementById('editName').value.trim());
      const cat = document.getElementById('editCat').value;
      const hasLimit = document.getElementById('editBadgeLimit').checked;
      const idx = document.getElementById('editIndex').value;
      const msg = document.getElementById('editMsg');

      // Auto-use filename if name is empty and files are uploaded
      if (!name && editSelectedFiles.length > 0) {
        name = toSimplified(editSelectedFiles[0].name.replace(/\.[^.]+$/, ''));
      }
      if (!name) { msg.textContent = '请输入素材名称或上传文件'; msg.className = 'modal-msg error'; return; }

      const hasHot = document.getElementById('editBadgeHot').checked;
      const hasVip = document.getElementById('editBadgeVip').checked;
      const hasRecommend = document.getElementById('editBadgeRecommend').checked;
      const hasFree = document.getElementById('editBadgeFree').checked;

      const badges = ['版权', 'new'];
      if (hasLimit) badges.push('限时');
      if (hasHot) badges.push('热门');
      if (hasVip) badges.push('VIP');
      if (hasRecommend) badges.push('推荐');
      if (hasFree) badges.push('免费');

      const gradient = Math.floor(Math.random() * gradients.length);

      this.disabled = true;
      this.textContent = '保存中...';

      try {
        let d;
        if (idx !== '') {
          // Edit existing: update fields first
          d = await apiUpdateMaterial(parseInt(idx), { name, cat, badges, gradient });
          if (!d.ok) throw new Error(d.error);
          // Then upload only NEW files (not existing ones)
          const newFiles = editSelectedFiles.filter(f => !f._existing && f instanceof File);
          if (newFiles.length > 0) {
            const formData = new FormData();
            formData.append('username', currentUser.username);
            newFiles.forEach(f => formData.append('files', f));
            const ud = await apiUploadMaterialFiles(parseInt(idx), formData);
            if (!ud.ok) msg.textContent = '素材已更新，但文件上传失败：'+ud.error;
          }
          msg.textContent = '素材已更新！';
        } else {
          // New: use FormData to upload files with material data
          const formData = new FormData();
          formData.append('username', currentUser.username);
          formData.append('name', name);
          formData.append('cat', cat);
          formData.append('badges', badges.join(','));
          formData.append('gradient', gradient);
          editSelectedFiles.filter(f => f instanceof File).forEach(f => formData.append('files', f));
          d = await apiAddMaterialWithFiles(formData);
          if (!d.ok) throw new Error(d.error);
          if (d.warning) {
            msg.textContent = '素材已添加！\n⚠️ ' + d.warning;
            msg.style.whiteSpace = 'pre-line';
          } else {
            msg.textContent = '素材已添加！';
          }
        }
        msg.className = 'modal-msg';
        editSelectedFiles = [];
        renderEditFileList();
        setTimeout(() => { document.getElementById('editModal').classList.remove('active'); }, 500);
      } catch(e) {
        msg.textContent = e.message || '操作失败';
        msg.className = 'modal-msg error';
      } finally {
        this.disabled = false;
        this.textContent = '保存';
      }
    });

    // Card grid delegated events
    document.getElementById('cardGrid').addEventListener('click', function(e) {
      const editBtn = e.target.closest('.edit-btn');
      const delBtn = e.target.closest('.del-btn') || e.target.closest('.edit-del-btn');
      if (editBtn) {
        const idx = parseInt(editBtn.dataset.edit);
        const m = materials[idx];
        document.getElementById('editModalTitle').textContent = '编辑素材';
        document.getElementById('editName').value = m.name;
        document.getElementById('editCat').value = m.cat;
      document.getElementById('editBadgeLimit').checked = (m.badges||[]).includes('限时');
      document.getElementById('editBadgeHot').checked = (m.badges||[]).includes('热门');
      document.getElementById('editBadgeVip').checked = (m.badges||[]).includes('VIP');
      document.getElementById('editBadgeRecommend').checked = (m.badges||[]).includes('推荐');
      document.getElementById('editBadgeFree').checked = (m.badges||[]).includes('免费');
        document.getElementById('editIndex').value = idx;
        document.getElementById('editMsg').textContent = '';
        // Show existing uploaded files
        editSelectedFiles = [];
        renderEditFileList();
        if (m.uploadedFiles && m.uploadedFiles.length > 0) {
          const container = document.getElementById('editFileList');
          container.innerHTML = container.innerHTML + '<div style="font-size:12px;color:#6b7280;margin-bottom:4px">已上传的文件：</div>' +
            m.uploadedFiles.map((f, i) => '<div class="edit-file-item"><span>'+f.name+' <span class="file-size">'+formatSize(f.size)+'</span></span></div>').join('');
        }
        document.getElementById('editModal').classList.add('active');
      }
      if (delBtn) {
        const idx = parseInt(delBtn.dataset.del || delBtn.dataset.delIdx);
        apiDeleteMaterial(idx);
      }
    });

    // Edit mode category change
    document.getElementById('cardGrid').addEventListener('change', function(e) {
      if (e.target.classList.contains('edit-cat-select')) {
        const idx = parseInt(e.target.dataset.catIdx);
        const newCat = e.target.value;
        if (idx >= 0 && materials[idx]) {
          apiUpdateMaterial(idx, { cat: newCat });
        }
      }
    });

    // ===== INIT =====
    // Check URL path for category routing
    (function initFromURL() {
      const match = window.location.pathname.match(/^\/cat\/(.+)$/);
      if (match) {
        const cat = decodeURIComponent(match[1]);
        const validCats = ['人物', '表情包', '画师寄售', '背景图', '道具栏', '特效', '限时优惠'];
        if (validCats.includes(cat)) {
          currentCat = cat;
          document.querySelectorAll('.cat-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.cat === cat);
          });
          updateSEOTags(cat);
        }
      }
      // Also handle legacy ?cat= and ?id= query params
      const params = new URLSearchParams(window.location.search);
      if (params.has('cat')) {
        const qcat = params.get('cat');
        const validCats = ['人物', '表情包', '画师寄售', '背景图', '道具栏', '特效', '限时优惠'];
        if (validCats.includes(qcat)) {
          currentCat = qcat;
          document.querySelectorAll('.cat-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.cat === qcat);
          });
          // Redirect to clean URL
          history.replaceState({ cat: qcat }, '', '/cat/' + encodeURIComponent(qcat));
          updateSEOTags(qcat);
        }
      }
    })();

    updateUserBar();
    loadMaterials();
    // Try to auto-login if there's a saved session with password
    (async function autoLogin() {
      if (!currentUser) return;
      try {
        const saved = JSON.parse(localStorage.getItem('lz_passwords') || '{}');
        const pwd = saved[currentUser.username];
        if (pwd) {
          const d = await apiLogin(currentUser.username, pwd);
          if (d.ok) {
            currentUser = d.user;
            try { localStorage.setItem('lz_user', JSON.stringify(currentUser)); } catch(e) {}
            updateUserBar();
          }
        }
      } catch(e) {}
    })();

    // === Toast Notification ===
    function showToast(msg, duration) {
      duration = duration || 3000;
      var t = document.getElementById("globalToast");
      if (!t) {
        t = document.createElement("div");
        t.id = "globalToast";
        t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);background:rgba(30,30,30,0.92);color:#fff;padding:10px 22px;border-radius:10px;font-size:14px;z-index:999999;transition:transform 0.35s cubic-bezier(0.16,1,0.3,1),opacity 0.35s;opacity:0;pointer-events:none;backdrop-filter:blur(8px);box-shadow:0 4px 16px rgba(0,0,0,0.2);max-width:90vw;overflow:hidden;text-overflow:ellipsis";
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.style.opacity = "1";
      t.style.transform = "translateX(-50%) translateY(0)";
      clearTimeout(t._timer);
      t._timer = setTimeout(function() {
        t.style.opacity = "0";
        t.style.transform = "translateX(-50%) translateY(80px)";
      }, duration);
    }

    // === App Popup ===
    function openAppPopup(url, title) {
      // 检查是否是 AI 生图功能（维护中，管理员不受影响）
      const _isAdmin = currentUser && currentUser.role === 'admin';
      if (url.includes('/ai-image') && aiMaintenanceMode && !_isAdmin) {
        showToast('🔧 AI生图功能维护中，请稍后再试');
        return;
      }
      let overlay = document.getElementById('appPopupOverlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'appPopupOverlay';
        overlay.innerHTML = `
          <style>
            #appPopupOverlay {
              position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);
              display:none;align-items:center;justify-content:center;
              backdrop-filter:blur(4px);
            }
            #appPopupOverlay.show { display:flex; }
            #appPopupBox {
              background:#fff;border-radius:12px;width:94vw;height:92vh;
              display:flex;flex-direction:column;overflow:hidden;
              box-shadow:0 20px 60px rgba(0,0,0,0.4);
              animation:appPopIn 0.25s ease;position:relative;
            }
            @keyframes appPopIn {
              from { transform:scale(0.92);opacity:0 }
              to { transform:scale(1);opacity:1 }
            }
            #appPopupHeader {
              display:flex;align-items:center;justify-content:space-between;
              padding:10px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;
              flex-shrink:0;
            }
            #appPopupHeader span { font-size:15px;font-weight:600;color:#1e293b; }
            #appPopupHeader button {
              width:32px;height:32px;border-radius:8px;border:none;
              background:#fee2e2;color:#dc2626;cursor:pointer;font-size:18px;
              display:flex;align-items:center;justify-content:center;
              transition:background 0.2s;
            }
            #appPopupHeader button:hover { background:#fecaca; }
            #appPopupIframe {
              flex:1;width:100%;border:none;background:#fff;
            }
          </style>
          <div id="appPopupBox">
            <div id="appPopupHeader">
              <span id="appPopupTitle"></span>
              <button onclick="closeAppPopup()" title="關閉">✕</button>
            </div>
            <iframe id="appPopupIframe" allow="clipboard-write; microphone"></iframe>
            <div id="watermarkCover" style="display:none;position:absolute;bottom:0;right:0;width:220px;height:36px;z-index:99999;pointer-events:none;background:#fff;border-radius:8px 0 0 0;"></div>
          </div>
        `;
        document.body.appendChild(overlay);
      }
      document.getElementById('appPopupTitle').textContent = title;
      if (_isAdmin && url.includes('/ai-image') && !url.includes('?')) { url = url + '?admin=1'; }
      document.getElementById('appPopupIframe').src = url;
      const wmCover = document.getElementById('watermarkCover');
      if (wmCover) wmCover.style.display = 'none';
      overlay.classList.add('show');
      document.body.style.overflow = 'hidden';
    }

    function closeAppPopup() {
      const overlay = document.getElementById('appPopupOverlay');
      if (overlay) {
        overlay.classList.remove('show');
        document.getElementById('appPopupIframe').src = 'about:blank';
        const wmCover2 = document.getElementById('watermarkCover');
        if (wmCover2) wmCover2.style.display = 'none';
        document.body.style.overflow = '';
      }
    }

    // ESC key closes popup
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeAppPopup();
    });