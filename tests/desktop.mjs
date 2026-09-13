import { _electron as electron } from '@playwright/test';
import { createApp } from '../server/index.js';
import assert from 'node:assert/strict';

const {server}=createApp({dbPath:':memory:'});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
let application;
try {
  const env={...process.env,HIMS_SERVER_URL:url,HIMS_DESKTOP_TEST:'true'};
  delete env.ELECTRON_RUN_AS_NODE;
  application=await electron.launch({args:['desktop/main.cjs'],env});
  const page=await application.firstWindow();
  await page.getByRole('heading',{name:'Set up your hospital'}).waitFor();
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  const prefs=await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.sandbox,true);
  await page.getByLabel('Full name').fill('Desktop Admin');
  await page.getByLabel('Email address').fill('desktop@example.test');
  await page.getByLabel('Password',{exact:true}).fill('Desktop-test-password!');
  await page.getByRole('button',{name:'Create administrator account'}).click();
  await page.getByRole('heading',{name:'Welcome, Desktop.'}).waitFor();
  const setup=await fetch(url+'/api/setup').then(r=>r.json());
  assert.equal(setup.setupRequired,false);
  console.log('Desktop passed: shared server connection, setup/login, renderer isolation, and sandbox.');
} finally {
  if(application)await application.close();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
