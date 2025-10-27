// 전역 변수
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordingTimer = null;
let startTime = 0;
let currentAudioFile = null;
let sessionHistory = [];
let openTabs = new Map(); // 열려있는 탭들
let activeTabId = 'welcome';
let tabCounter = 1;

// VS Code 스타일 파일 시스템 시뮬레이션
let fileSystem = {
    '/': {
        type: 'folder',
        name: '강의 요약 프로젝트',
        children: {
            'recordings': {
                type: 'folder',
                name: '녹음 파일',
                children: {}
            },
            'summaries': {
                type: 'folder',
                name: '요약 파일',
                children: {}
            }
        }
    }
};

// DOM이 로드되면 실행
document.addEventListener('DOMContentLoaded', function() {
    console.log('강의 요약 AI가 로드되었습니다.');

    initializeApp();
    loadSessionHistory();
    initializeTabs();
    setupSidebarTabs();
});

// 앱 초기화
function initializeApp() {
    checkMicrophonePermission();
    setupEventListeners();
    updateFileTree();
    updateSummariesList();
    
    console.log('앱이 초기화되었습니다.');
}

// 탭 시스템 초기화
function initializeTabs() {
    openTabs.set('welcome', {
        id: 'welcome',
        title: '시작하기',
        type: 'welcome',
        icon: 'fas fa-home',
        closable: false
    });
    
    updateTabBar();
}

// 사이드바 탭 설정
function setupSidebarTabs() {
    const sidebarTabs = document.querySelectorAll('.sidebar-tab');
    
    sidebarTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const panelId = this.dataset.panel;
            switchSidebarPanel(panelId);
        });
    });
}

// 사이드바 토글 버튼
function toggleSidebarMini() {
    const sidebar = document.querySelector('.sidebar');
    const btn = document.querySelector('.sidebar-toggle-btn');
    const icon = btn.querySelector('i');

    sidebar.classList.toggle('mini');

    // 아이콘 방향 전환
    if (sidebar.classList.contains('mini')) {
        icon.classList.remove('fa-chevron-left');
        icon.classList.add('fa-chevron-right');
    } else {
        icon.classList.remove('fa-chevron-right');
        icon.classList.add('fa-chevron-left');
    }
}

// 사이드바 패널 전환
function switchSidebarPanel(panelId) {
    // 탭 활성화 상태 변경
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-panel="${panelId}"]`).classList.add('active');
    
    // 패널 표시 변경
    document.querySelectorAll('.sidebar-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    document.getElementById(`${panelId}-panel`).classList.add('active');
}

// 마이크 권한 확인
async function checkMicrophonePermission() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        console.log('마이크 권한이 허용되었습니다.');
    } catch (error) {
        console.error('마이크 권한이 거부되었습니다:', error);
        showNotification('error', '마이크 권한이 필요합니다. 브라우저 설정에서 마이크 권한을 허용해주세요.');
    }
}

function setupEventListeners() {
    // 키보드 단축키
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey || e.metaKey) {
            switch(e.key) {
                case 'n':
                    e.preventDefault();
                    showNewFileMenu();
                    break;
                case 'w':
                    e.preventDefault();
                    closeActiveTab();
                    break;
                case 't':
                    e.preventDefault();
                    startRecording();
                    break;
            }
        }
        
        // ESC 키로 모달 닫기
        if (e.key === 'Escape') {
            closeRecordingModal();
            hideNewFileMenu();
        }
    });

    // 클릭 이벤트로 메뉴 닫기
    document.addEventListener('click', function(e) {
        const newFileMenu = document.getElementById('newFileMenu');
        const newFileBtn = document.querySelector('.new-file-btn');
        
        if (!newFileMenu.contains(e.target) && !newFileBtn.contains(e.target)) {
            hideNewFileMenu();
        }
    });
}

// 새 파일 메뉴 표시
function showNewFileMenu() {
    const menu = document.getElementById('newFileMenu');
    menu.classList.add('show');
}

// 새 파일 메뉴 숨기기
function hideNewFileMenu() {
    const menu = document.getElementById('newFileMenu');
    menu.classList.remove('show');
}

// 실시간 녹음 시작
function startRecording() {
    hideNewFileMenu();
    showRecordingModal('recording');
}

// 파일 업로드 시작
function uploadFile() {
    hideNewFileMenu();
    showRecordingModal('upload');
}

// 녹음 모달 표시
function showRecordingModal(type) {
    const modal = document.getElementById('recordingModal');
    const title = document.getElementById('modalTitle');
    const recordingControls = document.getElementById('recordingControls');
    const uploadControls = document.getElementById('uploadControls');
    
    if (type === 'recording') {
        title.textContent = '실시간 녹음';
        recordingControls.style.display = 'block';
        uploadControls.style.display = 'none';
    } else {
        title.textContent = '파일 업로드';
        recordingControls.style.display = 'none';
        uploadControls.style.display = 'block';
    }
    
    modal.classList.add('show');
    disableSummarizeButton();
}

// 녹음 모달 닫기
function closeRecordingModal() {
    const modal = document.getElementById('recordingModal');
    modal.classList.remove('show');
    
    // 녹음 중이면 중지
    if (isRecording) {
        toggleRecording();
    }
    
    // 상태 초기화
    currentAudioFile = null;
    disableSummarizeButton();
    document.getElementById('audioFile').value = '';
}

// 실시간 녹음 토글
async function toggleRecording() {
    const recordBtn = document.getElementById('recordBtn');
    const recordingStatus = document.getElementById('recordingStatus');
    const statusText = recordingStatus.querySelector('.status-text');
    const timer = document.getElementById('recordingTimer');
    
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 44100,
                    channelCount: 1,
                    volume: 1.0
                }
            });
            
            mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            
            recordedChunks = [];
            
            mediaRecorder.ondataavailable = function(event) {
                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = function() {
                const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
                currentAudioFile = audioBlob;
                enableSummarizeButton();
                
                showNotification('success', '녹음이 완료되었습니다!');
            };
            
            mediaRecorder.start();
            isRecording = true;
            startTime = Date.now();
            
            // UI 업데이트
            recordBtn.classList.add('recording');
            recordBtn.innerHTML = '<i class="fas fa-stop"></i><span>녹음 중지</span>';
            statusText.textContent = '녹음 중';
            timer.classList.add('active');
            
            // 타이머 시작
            recordingTimer = setInterval(updateTimer, 1000);
            
        } catch (error) {
            console.error('녹음 시작 실패:', error);
            showNotification('error', '녹음을 시작할 수 없습니다. 마이크 권한을 확인해주세요.');
        }
    } else {
        // 녹음 중지
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        
        isRecording = false;
        clearInterval(recordingTimer);
        
        // UI 업데이트
        recordBtn.classList.remove('recording');
        recordBtn.innerHTML = '<i class="fas fa-microphone"></i><span>녹음 시작</span>';
        statusText.textContent = '완료됨';
        timer.classList.remove('active');
    }
}

// 녹음 타이머 업데이트
function updateTimer() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    
    const timer = document.getElementById('recordingTimer');
    timer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// 파일 업로드 처리
function handleFileUpload(event) {
    const file = event.target.files[0];
    
    if (!file) return;
    
    if (!file.type.startsWith('audio/')) {
        showNotification('error', '오디오 파일만 업로드할 수 있습니다.');
        return;
    }
    
    if (file.size > 100 * 1024 * 1024) {
        showNotification('error', '파일 크기는 100MB 이하여야 합니다.');
        return;
    }
    
    currentAudioFile = file;
    enableSummarizeButton();
    
    showNotification('success', `파일 "${file.name}"이 업로드되었습니다.`);
}

// 요약 생성
async function summarizeAudio() {
    if (!currentAudioFile) {
        showNotification('error', '먼저 오디오를 녹음하거나 파일을 업로드해주세요.');
        return;
    }
    
    showLoading(true);
    
    try {
        await simulateSummarization();
        closeRecordingModal();
    } catch (error) {
        console.error('요약 실패:', error);
        showNotification('error', '요약 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
        showLoading(false);
    }
}

// 요약 시뮬레이션
async function simulateSummarization() {
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const timestamp = new Date();
    const fileName = currentAudioFile instanceof File ? 
        currentAudioFile.name : 
        `recording_${timestamp.getTime()}.webm`;
    
    const summary = {
        id: Date.now(),
        title: `${fileName} 요약`,
        fileName: fileName,
        content: generateMockSummary(),
        timestamp: timestamp.toLocaleString('ko-KR'),
        type: currentAudioFile instanceof File ? 'file' : 'recording'
    };
    
    // 탭으로 요약 결과 표시
    createSummaryTab(summary);
    
    // 파일 시스템에 추가
    addToFileSystem(summary);
    
    // 히스토리에 추가
    addToHistory(summary);
    
    // UI 업데이트
    updateFileTree();
    updateSummariesList();
    updateRecentItems();
}

// 모의 요약 내용 생성
function generateMockSummary() {
    return `# 강의 요약

## 📝 주요 내용

### 1. 핵심 개념
- **개념 A**: 강의의 첫 번째 주요 개념에 대한 상세한 설명
- **개념 B**: 두 번째 핵심 개념과 실제 적용 방법
- **개념 C**: 세 번째 개념과 이전 개념들과의 연관성

### 2. 실습 내용
1. 기본 설정 및 환경 구성
2. 단계별 실습 진행
3. 결과 확인 및 검증

### 3. 중요 포인트
> 💡 **핵심 메시지**: 이 강의에서 가장 중요한 포인트

- ⚠️ 주의사항: 실습 시 반드시 확인해야 할 사항들
- 📌 팁: 효율적인 학습을 위한 추가 팁들

## 📚 추가 학습 자료

### 참고 문서
- 관련 문서 1
- 관련 문서 2
- 온라인 리소스

### 실습 과제
1. 기본 과제: 강의 내용 복습
2. 심화 과제: 응용 문제 해결
3. 프로젝트: 실제 적용 사례 개발

## 🔗 키워드
\`#강의요약\` \`#학습\` \`#실습\` \`#핵심개념\`

---
*이 요약은 AI에 의해 자동 생성되었습니다.*`;
}

// 요약 탭 생성
function createSummaryTab(summary) {
    const tabId = `summary_${summary.id}`;
    
    // 탭 정보 저장
    openTabs.set(tabId, {
        id: tabId,
        title: summary.title,
        type: 'summary',
        icon: 'fas fa-file-alt',
        closable: true,
        data: summary
    });
    
    // 탭 콘텐츠 생성
    createTabContent(tabId, summary);
    
    // 탭으로 전환
    switchToTab(tabId);
    
    // 탭 바 업데이트
    updateTabBar();
}

// 탭 콘텐츠 생성
function createTabContent(tabId, summary) {
    const tabContents = document.querySelector('.tab-contents');
    const tabContent = document.createElement('div');
    tabContent.className = 'tab-content';
    tabContent.id = `${tabId}-content`;

    // result 섹션 (요약/화자 구분/전체 텍스트 전환 UI)
    tabContent.innerHTML = `
    <div class="summary-viewer">
      <div class="summary-header">
        <div class="summary-meta">
          <h1>${summary.title}</h1>
          <div class="summary-info">
            <span class="summary-type">
              <i class="fas ${summary.type === 'file' ? 'fa-file-audio' : 'fa-microphone'}"></i>
              ${summary.type === 'file' ? '파일 업로드' : '실시간 녹음'}
            </span>
            <span class="summary-date">${summary.timestamp}</span>
          </div>
        </div>
        <div class="summary-actions">
          <button class="action-btn" onclick="exportSummary('${tabId}')" title="내보내기">
            <i class="fas fa-download"></i>
          </button>
          <button class="action-btn" onclick="copySummary('${tabId}')" title="복사">
            <i class="fas fa-copy"></i>
          </button>
        </div>
      </div>

      <section class="result">
        <div class="result-row">
          <button class="btn active" id="show-summary-${tabId}" onclick="showResult('${tabId}','summary')">요약본</button>
          <button class="btn" id="show-raw-${tabId}" onclick="showResult('${tabId}','raw')">화자 구분</button>
          <button class="btn" id="show-plain-${tabId}" onclick="showResult('${tabId}','plain')">전체 텍스트</button>
          
          <button class="btn ghost" title="텍스트 복사" onclick="copyResultText('${tabId}')" style="max-width:120px;">
            <i class="fas fa-copy"></i>&nbsp;<span>복사</span>
          </button>
        </div>
        <div id="output-${tabId}" class="resultbox">
          ${markdownToHtml(summary.content)}
        </div>
      </section>
    </div>
    `;

    tabContents.appendChild(tabContent);
}

function showResult(tabId, type) {
    const output = document.getElementById(`output-${tabId}`);
    const btns = [
        document.getElementById(`show-summary-${tabId}`),
        document.getElementById(`show-raw-${tabId}`),
        document.getElementById(`show-plain-${tabId}`)
    ];
    btns.forEach(btn => btn.classList.remove('active'));

    switch (type) {
        // 더미 데이터(추후 API 연결 예정)
        case 'summary':
            btns[0].classList.add('active');
            output.innerHTML = markdownToHtml(generateMockSummary());
            break;
        case 'raw':
            btns[1].classList.add('active');
            output.innerHTML = `<p><strong>[화자1]</strong> HTML은 프로그래밍 언어인가요?<br><strong>[화자2]</strong> 네.</p>`;
            break;
        case 'plain':
            btns[2].classList.add('active');
            output.innerHTML = `<p>안녕하세요. 오늘 수업은 여기까지입니다.</p>`;
            break;
    }
}

// 간단한 마크다운 to HTML 변환
function markdownToHtml(markdown) {
    return markdown
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*)\*/gim, '<em>$1</em>')
        .replace(/`(.*)`/gim, '<code>$1</code>')
        .replace(/^\- (.*$)/gim, '<li>$1</li>')
        .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
        .replace(/\n/gim, '<br>');
}

// 탭 전환
function switchToTab(tabId) {
    // 모든 탭 콘텐츠 숨기기
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // 선택된 탭 콘텐츠 표시
    const targetContent = document.getElementById(`${tabId}-content`);
    if (targetContent) {
        targetContent.classList.add('active');
    }
    
    activeTabId = tabId;
    updateTabBar();
}

// 탭 바 업데이트
function updateTabBar() {
    const tabBar = document.getElementById('tabBar');
    tabBar.innerHTML = '';
    
    openTabs.forEach((tab, tabId) => {
        const tabElement = document.createElement('div');
        tabElement.className = `tab ${tabId === activeTabId ? 'active' : ''}`;
        tabElement.dataset.tabId = tabId;
        
        tabElement.innerHTML = `
            <span class="tab-title">${tab.title}</span>
            ${tab.closable ? 
                `<i class="fas fa-times tab-close" onclick="closeTab('${tabId}', event)"></i>` :
                `<i class="${tab.icon} tab-icon"></i>`
            }
        `;
        
        tabElement.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                switchToTab(tabId);
            }
        });
        
        tabBar.appendChild(tabElement);
    });
}

// 탭 닫기
function closeTab(tabId, event) {
    if (event) event.stopPropagation();
    
    // 탭 정보 제거
    openTabs.delete(tabId);
    
    // 탭 콘텐츠 제거
    const tabContent = document.getElementById(`${tabId}-content`);
    if (tabContent) {
        tabContent.remove();
    }
    
    // 활성 탭이 닫힌 경우 다른 탭으로 전환
    if (tabId === activeTabId) {
        const remainingTabs = Array.from(openTabs.keys());
        if (remainingTabs.length > 0) {
            switchToTab(remainingTabs[0]);
        }
    }
    
    updateTabBar();
}

// 활성 탭 닫기
function closeActiveTab() {
    const activeTab = openTabs.get(activeTabId);
    if (activeTab && activeTab.closable) {
        closeTab(activeTabId);
    }
}

// 파일 시스템에 추가
function addToFileSystem(summary) {
    const folderPath = summary.type === 'file' ? '/recordings' : '/summaries';
    const folder = fileSystem['/'].children[folderPath.substring(1)];
    
    folder.children[summary.fileName] = {
        type: 'file',
        name: summary.fileName,
        summary: summary,
        extension: summary.type === 'file' ? 'audio' : 'md'
    };
}

// 파일 트리 업데이트
function updateFileTree() {
    updateFolderContents('recordingsFolder', fileSystem['/'].children.recordings.children);
    updateFolderContents('summariesFolder', fileSystem['/'].children.summaries.children);
}

// 폴더 내용 업데이트
function updateFolderContents(folderId, children) {
    const folder = document.getElementById(folderId);
    folder.innerHTML = '';
    
    Object.values(children).forEach(item => {
        const itemElement = document.createElement('div');
        itemElement.className = 'tree-node file';
        
        const icon = item.extension === 'audio' ? 'fa-file-audio' : 'fa-file-alt';
        
        itemElement.innerHTML = `
            <div class="tree-node-content" onclick="openFile('${item.name}', '${item.extension}')">
                <i class="fas ${icon}"></i>
                <span>${item.name}</span>
            </div>
        `;
        
        folder.appendChild(itemElement);
    });
}

// 폴더 토글
function toggleFolder(element) {
    const treeNode = element.closest('.tree-node');
    treeNode.classList.toggle('expanded');
}

// 파일 열기
function openFile(fileName, extension) {
    // 파일에서 요약 찾기
    let summary = null;
    
    Object.values(fileSystem['/'].children).forEach(folder => {
        Object.values(folder.children).forEach(file => {
            if (file.name === fileName && file.summary) {
                summary = file.summary;
            }
        });
    });
    
    if (summary) {
        const tabId = `summary_${summary.id}`;
        
        // 이미 열려있는 탭인지 확인
        if (openTabs.has(tabId)) {
            switchToTab(tabId);
        } else {
            createSummaryTab(summary);
        }
    }
}

// 히스토리에 추가
function addToHistory(summary) {
    sessionHistory.unshift(summary);
    
    if (sessionHistory.length > 20) {
        sessionHistory = sessionHistory.slice(0, 20);
    }
    
    saveSessionHistory();
    updateSummariesList();
    updateRecentItems();
}

// 요약 리스트 업데이트
function updateSummariesList() {
    const summariesList = document.getElementById('summariesList');
    
    if (sessionHistory.length === 0) {
        summariesList.innerHTML = '<p style="text-align: center; color: #8c8c8c; padding: 20px;">아직 요약 기록이 없습니다.</p>';
        return;
    }
    
    summariesList.innerHTML = '';
    
    sessionHistory.forEach(summary => {
        const summaryElement = document.createElement('div');
        summaryElement.className = 'summary-item';
        summaryElement.onclick = () => openSummaryFromHistory(summary);
        
        summaryElement.innerHTML = `
            <h4>${summary.title}</h4>
            <p>${summary.type === 'file' ? '파일 업로드' : '실시간 녹음'}</p>
            <div class="summary-date">${summary.timestamp}</div>
        `;
        
        summariesList.appendChild(summaryElement);
    });
}

// 히스토리에서 요약 열기
function openSummaryFromHistory(summary) {
    const tabId = `summary_${summary.id}`;
    
    if (openTabs.has(tabId)) {
        switchToTab(tabId);
    } else {
        createSummaryTab(summary);
    }
}

// 최근 항목 업데이트
function updateRecentItems() {
    const recentItems = document.getElementById('recentItems');
    const recentSummaries = sessionHistory.slice(0, 3);
    
    if (recentSummaries.length === 0) {
        recentItems.innerHTML = '<p style="text-align: center; color: #8c8c8c;">최근 요약이 없습니다.</p>';
        return;
    }
    
    recentItems.innerHTML = '';
    
    recentSummaries.forEach(summary => {
        const itemElement = document.createElement('div');
        itemElement.className = 'recent-item';
        itemElement.onclick = () => openSummaryFromHistory(summary);
        
        itemElement.innerHTML = `
            <h4>${summary.title}</h4>
            <p>${summary.timestamp} | ${summary.type === 'file' ? '파일 업로드' : '실시간 녹음'}</p>
        `;
        
        recentItems.appendChild(itemElement);
    });
}

// 요약 새로고침
function refreshSummaries() {
    updateSummariesList();
    showNotification('success', '요약 목록이 새로고침되었습니다.');
}

// 모든 요약 삭제
function clearAllSummaries() {
    if (confirm('모든 요약 기록을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
        sessionHistory = [];
        
        // 파일 시스템 초기화
        fileSystem['/'].children.recordings.children = {};
        fileSystem['/'].children.summaries.children = {};
        
        // 열려있는 요약 탭들 닫기
        const summaryTabs = Array.from(openTabs.keys()).filter(id => id.startsWith('summary_'));
        summaryTabs.forEach(tabId => closeTab(tabId));
        
        // UI 업데이트
        updateFileTree();
        updateSummariesList();
        updateRecentItems();
        saveSessionHistory();
        
        showNotification('success', '모든 요약 기록이 삭제되었습니다.');
    }
}

// 요약본 클립보드 복사
async function copyResultText(tabId) {
  const box = document.getElementById(`output-${tabId}`);
  if (!box) return;

  // 보통은 '텍스트'만 복사하는 게 안전함 (마크업 제거)
  const text = box.innerText;

  try {
    await navigator.clipboard.writeText(text);
    showNotification('success', '텍스트가 클립보드에 복사되었습니다.');
    flashCopyBtn(tabId); // 선택: 버튼에 잠깐 "복사됨" 표시
  } catch (e) {
    // 폴백: 임시 textarea
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showNotification('success', '텍스트가 클립보드에 복사되었습니다.');
      flashCopyBtn(tabId);
    } catch {
      showNotification('error', '복사에 실패했습니다.');
    } finally {
      document.body.removeChild(ta);
    }
  }
}

// 복사 성공 메세지 출력
function flashCopyBtn(tabId) {
  const btn = document.querySelector(`#${tabId}-content .result .result-row .btn.ghost`);
  if (!btn) return;
  const icon = btn.querySelector('i');
  const span = btn.querySelector('span');
  const old = span.textContent;
  span.textContent = '복사됨';
  icon.classList.remove('fa-copy');
  icon.classList.add('fa-check');
  setTimeout(() => {
    span.textContent = old;
    icon.classList.remove('fa-check');
    icon.classList.add('fa-copy');
  }, 1200);
}

// 버튼 상태 관리
function enableSummarizeButton() {
    const summarizeBtn = document.getElementById('summarizeBtn');
    summarizeBtn.disabled = false;
}

function disableSummarizeButton() {
    const summarizeBtn = document.getElementById('summarizeBtn');
    summarizeBtn.disabled = true;
}

// 알림 표시
function showNotification(type, message) {
    // 간단한 알림 (실제 구현시 토스트 알림으로 개선)
    const alertType = type === 'error' ? '오류' : '알림';
    console.log(`[${alertType}] ${message}`);
    
    // 브라우저 알림으로 임시 구현
    if (type === 'error') {
        alert(`❌ ${message}`);
    } else {
        console.log(`✅ ${message}`);
    }
}

// 로딩 오버레이 제어
function showLoading(show) {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (show) {
        loadingOverlay.classList.add('active');
    } else {
        loadingOverlay.classList.remove('active');
    }
}

// 세션 히스토리 저장/불러오기
function saveSessionHistory() {
    try {
        localStorage.setItem('vscode_lectureAI_history', JSON.stringify(sessionHistory));
    } catch (error) {
        console.error('히스토리 저장 실패:', error);
    }
}

function loadSessionHistory() {
    try {
        const saved = localStorage.getItem('vscode_lectureAI_history');
        if (saved) {
            sessionHistory = JSON.parse(saved);
            
            // 파일 시스템 복원
            sessionHistory.forEach(summary => {
                addToFileSystem(summary);
            });
            
            updateFileTree();
            updateSummariesList();
            updateRecentItems();
        }
    } catch (error) {
        console.error('히스토리 불러오기 실패:', error);
        sessionHistory = [];
    }
}

// 정리 작업
window.addEventListener('beforeunload', function() {
    if (isRecording && mediaRecorder) {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
});

// 에러 처리
window.addEventListener('error', function(e) {
    console.error('JavaScript 에러 발생:', e.error);
    showNotification('error', '예상치 못한 오류가 발생했습니다.');
});

console.log('VS Code 스타일 강의 요약 AI 스크립트가 로드되었습니다.');