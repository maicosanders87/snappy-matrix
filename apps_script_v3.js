// ===========================================================
// Snappy Dashboard Sync — Apps Script v3
// Includes: data sync + Google Drive file storage
//
// WHAT'S NEW in v3:
// - uploadFile: saves file to Drive, then stores driveFileId 
//   in a dedicated "techfile_uploads" row so the app picks it
//   up on next sync pull (no polling needed)
// - getFile: returns file content from Drive as base64 data URL
//
// DEPLOYMENT STEPS:
// 1. Go to https://script.google.com and open your existing project
// 2. Replace the ENTIRE Code.gs with this file
// 3. Click Deploy → Manage deployments
// 4. Click the pencil/edit icon on your existing deployment
// 5. Under "Version" select "New version"
// 6. Click Deploy
// 7. If prompted for permissions (Drive access), click "Review Permissions"
//    → Choose your Google account → "Advanced" → "Go to Snappy..." → Allow
// ===========================================================

var SHEET_ID = '1033ULekFZ6qNBwiT5_ruLgIlxgdIjYiVrec9L96comQ';
var DRIVE_FOLDER_NAME = 'Snappy Tech Files';

// Get or create the Drive folder for tech files
function getDriveFolder() {
  var folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

// ---- GET handler ----
function doGet(e) {
  var callback = e.parameter.callback;
  var action = e.parameter.action;
  
  // === getFile: return file content from Drive as base64 ===
  if (action === 'getFile') {
    var fileId = e.parameter.fileId;
    try {
      var file = DriveApp.getFileById(fileId);
      var blob = file.getBlob();
      var base64 = Utilities.base64Encode(blob.getBytes());
      var mimeType = blob.getContentType();
      var dataUrl = 'data:' + mimeType + ';base64,' + base64;
      var result = { status: 'ok', fileData: dataUrl, fileName: file.getName() };
    } catch (err) {
      var result = { status: 'error', message: err.message };
    }
    if (callback) {
      return ContentService.createTextOutput(callback + '(' + JSON.stringify(result) + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // === Normal data sync read ===
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheets()[0];
    var data = sheet.getDataRange().getValues();
    var result = {};
    for (var i = 1; i < data.length; i++) {
      if (data[i][0]) {
        result[data[i][0]] = { val: data[i][1], updated: data[i][2] };
      }
    }
    var response = { status: 'ok', result: result };
    if (callback) {
      return ContentService.createTextOutput(callback + '(' + JSON.stringify(response) + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    var errResponse = { status: 'error', message: err.message };
    if (callback) {
      return ContentService.createTextOutput(callback + '(' + JSON.stringify(errResponse) + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(JSON.stringify(errResponse))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ---- POST handler ----
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheets()[0];
    
    // === uploadFile: save to Drive, store driveFileId in Sheet ===
    if (body._action === 'uploadFile') {
      var folder = getDriveFolder();
      var fileName = body.fileName || 'untitled';
      var techName = body.techName || 'Unknown';
      var fileEntryId = body.fileEntryId || '';
      var fileDataUrl = body.fileData; // data:mime;base64,...
      
      // Parse data URL
      var parts = fileDataUrl.split(',');
      var mimeMatch = parts[0].match(/data:([^;]+)/);
      var mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
      var base64Data = parts[1];
      
      var decoded = Utilities.base64Decode(base64Data);
      var blob = Utilities.newBlob(decoded, mimeType, techName + '_' + fileName);
      var file = folder.createFile(blob);
      var driveFileId = file.getId();
      
      // Store mapping: fileEntryId → driveFileId in a dedicated row
      // The app reads "techfile_drivemap" on sync to learn which files have Drive copies
      var data = sheet.getDataRange().getValues();
      var mapRow = -1;
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === 'techfile_drivemap') { mapRow = i + 1; break; }
      }
      
      var existingMap = {};
      if (mapRow > 0) {
        try { existingMap = JSON.parse(data[mapRow - 1][1]); } catch(ex) {}
      }
      existingMap[fileEntryId] = driveFileId;
      var mapJson = JSON.stringify(existingMap);
      var now = new Date().toISOString();
      
      if (mapRow > 0) {
        sheet.getRange(mapRow, 2).setValue(mapJson);
        sheet.getRange(mapRow, 3).setValue(now);
      } else {
        sheet.appendRow(['techfile_drivemap', mapJson, now]);
      }
      
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', driveFileId: driveFileId }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // === Normal data sync write ===
    var data = sheet.getDataRange().getValues();
    var now = new Date().toISOString();
    
    var keyRows = {};
    for (var i = 1; i < data.length; i++) {
      if (data[i][0]) keyRows[data[i][0]] = i + 1;
    }
    
    for (var key in body) {
      if (key.charAt(0) === '_') continue;
      var val = body[key];
      if (typeof val === 'object') val = JSON.stringify(val);
      if (keyRows[key]) {
        sheet.getRange(keyRows[key], 2).setValue(val);
        sheet.getRange(keyRows[key], 3).setValue(now);
      } else {
        sheet.appendRow([key, val, now]);
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
