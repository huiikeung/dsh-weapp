const test = require('node:test');
const assert = require('node:assert/strict');
const { stageFiles, chooseAndStage, cleanupStagedFiles, MAX_FILE_BYTES, MAX_IMAGE_BYTES } =
  require('../ascf/ascf_src/pages/session/utils/file-picker');

function runtime(handlers = {}) {
  const calls = [];
  const fs = {
    copyFile(options) {
      calls.push({ method: 'copyFile', options });
      if (handlers.copyFile) handlers.copyFile(options);
      else options.success({});
    },
    unlink(options) {
      calls.push({ method: 'unlink', options });
      if (handlers.unlink) handlers.unlink(options);
      else options.success({});
    }
  };
  const api = { getFileSystemManager: () => fs };
  if (handlers.chooseFile) api.chooseFile = handlers.chooseFile;
  return { api, calls };
}

const pickerFile = (name, size, path) => ({ name, size, path: path || 'file://media/' + name });

test('选择器缺失或文件系统不可用时明确失败', async () => {
  await assert.rejects(chooseAndStage({}, { type: 'file', count: 1 }), /picker is unavailable/);
  await assert.rejects(stageFiles({}, [pickerFile('a.pdf', 10)], {}), /File system unavailable/);
});

test('chooseFile 结果复制到 internal://cache 后才交给上传流程', async () => {
  const chosen = { type: '', count: 0 };
  const { api, calls } = runtime({
    chooseFile(options) { chosen.type = options.type; chosen.count = options.count; options.success({ tempFiles: [pickerFile('report.pdf', 2048)] }); }
  });
  const result = await chooseAndStage(api, { type: 'file', count: 3, idFactory: () => 'id-one' });
  assert.equal(chosen.type, 'file');
  assert.equal(chosen.count, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'copyFile');
  assert.equal(calls[0].options.srcPath, 'file://media/report.pdf');
  assert.equal(calls[0].options.destPath, 'internal://cache/dsh-picker-id-one.pdf');
  assert.deepEqual(result.files, [{ id: 'id-one', name: 'report.pdf', size: 2048, extension: 'pdf',
    tempPath: 'internal://cache/dsh-picker-id-one.pdf', staged: true }]);
  assert.equal(result.skipped, false);
});

test('超出大小限制或图片扩展名不支持的文件被跳过并上报', async () => {
  const { api, calls } = runtime({ idFactory: () => 'x' });
  const files = await stageFiles(api, [pickerFile('huge.pdf', MAX_FILE_BYTES + 1), pickerFile('note.txt', 10),
    pickerFile('a.svg', 10), pickerFile('', 10)], { type: 'image', idFactory: () => 'id-two' });
  assert.equal(files.files.length, 0);
  assert.equal(files.skipped, true);
  assert.equal(calls.length, 0);
  assert.equal(MAX_IMAGE_BYTES, 8 * 1024 * 1024);
});

test('复制失败时清理半成品并继续处理后续文件', async () => {
  let attempt = 0;
  const { api, calls } = runtime({
    copyFile(options) { attempt += 1; if (attempt === 1) options.fail({ errMsg: 'copyFile:fail' }); else options.success({}); }
  });
  const result = await stageFiles(api, [pickerFile('a.png', 10), pickerFile('b.png', 12)],
    { type: 'image', idFactory: (() => { let n = 0; return () => 'id-' + (++n); })() });
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].name, 'b.png');
  assert.equal(result.skipped, true);
  const unlinked = calls.filter(call => call.method === 'unlink').map(call => call.options.filePath);
  assert.deepEqual(unlinked, ['internal://cache/dsh-picker-id-1.png']);
});

test('清理只删除选择器暂存的沙箱副本', async () => {
  const { api, calls } = runtime();
  await cleanupStagedFiles(api, [
    { staged: true, tempPath: 'internal://cache/dsh-picker-a.pdf' },
    { staged: true, tempPath: 'internal://cache/other.pdf' },
    { tempPath: 'internal://cache/dsh-picker-b.pdf' },
    { staged: true, tempPath: 'file://media/x.pdf' }
  ]);
  assert.deepEqual(calls.filter(call => call.method === 'unlink').map(call => call.options.filePath),
    ['internal://cache/dsh-picker-a.pdf']);
});

test('文件名去路径分隔符且失败回调不抛出', async () => {
  const { api, calls } = runtime({
    chooseFile(options) { options.success({ tempFiles: [pickerFile('..\\evil/one.pdf', 5)] }); }
  });
  const result = await chooseAndStage(api, { type: 'file', count: 1, idFactory: () => 'safe' });
  assert.equal(result.files[0].name, '.._evil_one.pdf');
  assert.equal(calls[0].options.destPath, 'internal://cache/dsh-picker-safe.pdf');
  // 取消时保留原始 errMsg，页面才能识别 /cancel/i 而不弹错误提示。
  await assert.rejects(chooseAndStage({ chooseFile(options) { options.fail({ errMsg: 'chooseFile:fail cancel' }); },
    getFileSystemManager: () => ({}) }, { type: 'file', count: 1 }), err => err.errMsg === 'chooseFile:fail cancel');
});
