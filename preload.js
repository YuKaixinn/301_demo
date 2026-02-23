const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  saveQuestionnaireAnswers: (payload) => ipcRenderer.invoke('questionnaire:saveAnswers', payload),
  listQuestionnaireAnswers: (limit) => ipcRenderer.invoke('questionnaire:listAnswers', limit),
  getLatestQuestionnaire: (subjectId) => ipcRenderer.invoke('questionnaire:getLatest', subjectId),
  
  // Config API
  selectPath: () => ipcRenderer.invoke('config:selectPath'),
  selectFile: (options) => ipcRenderer.invoke('dialog:selectFile', options),
  selectFolder: () => ipcRenderer.invoke('config:selectFolder'),
  getPaths: () => ipcRenderer.invoke('config:getPaths'),
  setPath: (module, path) => ipcRenderer.invoke('config:setPath', module, path),
  getDefaultQuestionnaire: () => ipcRenderer.invoke('questionnaire:getDefault'),
  
  // Physio API
  savePhysioRecord: (data) => ipcRenderer.invoke('physio:saveRecord', data),
  listPhysioRecords: (limit) => ipcRenderer.invoke('physio:listRecords', limit),
  computeECG: (subjectId) => ipcRenderer.invoke('physio:computeECG', subjectId),
  computeEMG: (subjectId) => ipcRenderer.invoke('physio:computeEMG', subjectId),
  computeEye: (subjectId) => ipcRenderer.invoke('physio:computeEye', subjectId),
  exportPhysioSummary: (payload) => ipcRenderer.invoke('physio:exportSummary', payload),
  exportUnifiedCsv: () => ipcRenderer.invoke('export:unifiedCsv'),

  // Cognitive API
  saveCognitiveRecord: (data) => ipcRenderer.invoke('cognitive:saveRecord', data),
  listCognitiveRecords: (limit) => ipcRenderer.invoke('cognitive:listRecords', limit),
  importCognitivePdf: () => ipcRenderer.invoke('cognitive:importPdf'),

  analyzeGameScore: (subjectId) => ipcRenderer.invoke('game:analyze', subjectId),
  analyzeGameFile: (type, filePath) => ipcRenderer.invoke('game:analyzeFile', type, filePath),
  saveGameScore: (data) => ipcRenderer.invoke('game:save', data),
  listGameScores: (limit) => ipcRenderer.invoke('game:listHistory', limit),
  predictEleLevel: (subjectId) => ipcRenderer.invoke('ele:predictLevel', subjectId),
  predictCogType: (subjectId) => ipcRenderer.invoke('cog:predictType', subjectId),
  predictMotivationType: (subjectId) => ipcRenderer.invoke('mot:predictType', subjectId),
  predictMotivationLevel: (subjectId) => ipcRenderer.invoke('mot:predictLevel', subjectId),

  launchSoftware: (module, subjectId) => ipcRenderer.invoke('launch-software', module, subjectId),
  killAllProcesses: () => ipcRenderer.invoke('process:killAll'),

  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close')
});
