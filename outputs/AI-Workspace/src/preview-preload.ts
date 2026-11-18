import{contextBridge}from'electron';
// No workspace bridge is exposed to project pages.
window.addEventListener('click',event=>{const target=event.target as Element|null;if(target?.closest?.('input[type="file"]')){event.preventDefault();event.stopImmediatePropagation();}},true);
for(const name of['dragover','drop'])window.addEventListener(name,event=>{const e=event as DragEvent;if(e.dataTransfer?.files?.length){e.preventDefault();e.stopImmediatePropagation();}},true);

contextBridge.executeInMainWorld({func:()=>{for(const name of['showOpenFilePicker','showSaveFilePicker','showDirectoryPicker'])Object.defineProperty(window,name,{value:()=>Promise.reject(new DOMException('预览不选择电脑文件。','NotAllowedError')),configurable:false,writable:false});const original=HTMLInputElement.prototype.showPicker;if(original)Object.defineProperty(HTMLInputElement.prototype,'showPicker',{configurable:false,writable:false,value:function(this:HTMLInputElement){if(this.type==='file')throw new DOMException('预览不选择电脑文件。','NotAllowedError');return original.call(this);}});Object.defineProperty(window,'print',{value:()=>{},configurable:false,writable:false});}});
