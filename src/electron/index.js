// Packages
import {app, Tray, Menu, BrowserWindow, shell, clipboard, dialog} from 'electron'
import Config from 'electron-config'
import notify from 'display-notification'

// Ours
import {resolve as resolvePath} from 'app-root-path'
import moment from 'moment'
import menuItems from './menu'
import {error as showError} from './dialogs'
import share from './actions/share'
import autoUpdater from './updates'
import api from './api'

// Prevent garbage collection
// Otherwise the tray icon would randomly hide after some time
let tray = null
let loggedIn = false

// Hide dock icon and set app name
app.dock.hide()
app.setName('Now')

const config = new Config()

/*
config.set('now.user.token', 'FhPncJwhe2rskI7lPloAt6AX')
config.set('now.user.email', 'mindrun@icloud.com')
*/

const onboarding = () => {
  const win = new BrowserWindow({
    width: 600,
    height: 400,
    title: 'Welcome to now',
    resizable: false,
    center: true,
    frame: false,
    show: false,
    titleBarStyle: 'hidden-inset'
  })

  win.loadURL('file://' + resolvePath('../app/pages/welcome.html'))
  return win
}

const fileDropped = async (event, files) => {
  if (files.length > 1) {
    return showError('It\'s not yet possible to share multiple files/directories at once.')
  }

  await share(files[0])
  event.preventDefault()
}

const loadDeployments = async user => {
  const now = api(user.token)
  let list

  try {
    list = await now.getDeployments()
  } catch (err) {
    console.error(err)
    return false
  }

  return list
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('ready', async () => {
  let user
  let deployments

  // Automatically check for updates regularly
  if (process.platform !== 'linux') {
    autoUpdater()
  }

  // Check if now's configuration file exists
  if (config.has('now.user')) {
    user = config.get('now.user')

    // If yes, get the token and see if it's valid
    if (user.token) {
      deployments = await loadDeployments(user.token)
    }

    if (deployments) {
      loggedIn = true
    }
  }

  // DO NOT create the tray icon BEFORE the login status has been checked!
  // Otherwise, the user will start clicking...
  // ...the icon and the app wouldn't know what to do

  // I have no idea why, but path.resolve doesn't work here
  try {
    tray = new Tray(resolvePath('/icons/iconTemplate.png'))
  } catch (err) {
    return showError(err)
  }

  if (loggedIn) {
    tray.on('drop-files', fileDropped)

    for (const deployment of deployments) {
      const info = deployment
      const index = deployments.indexOf(deployment)

      const created = moment(new Date(parseInt(info.created, 10)))
      const url = 'https://' + info.url

      deployments[index] = {
        label: info.name,
        submenu: [
          {
            label: 'Open in Browser...',
            click: () => shell.openExternal(url)
          },
          {
            label: 'Copy URL to Clipboard',
            click() {
              clipboard.writeText(url)

              // Let the user know
              notify({
                title: 'Copied to clipboard',
                text: 'Your clipboard now contains the URL of your deployment.'
              })
            }
          },
          {
            type: 'separator'
          },
          {
            label: 'Delete...',
            click: async () => {
              // Ask the user if it was an accident
              const keepIt = dialog.showMessageBox({
                type: 'question',
                title: 'Removal of ' + info.name,
                message: 'Do you really want to delete this deployment?',
                detail: info.name,
                buttons: [
                  'Yes',
                  'Cancel'
                ]
              })

              // If so, do nothing
              if (keepIt) {
                return
              }

              // Otherwise, delete the deployment
              const now = api()

              try {
                await now.deleteDeployment(info.uid)
              } catch (err) {
                console.error(err)
                showError('Wasn\'t not able to remove deployment ' + info.name)

                return
              }

              notify({
                title: 'Deleted ' + info.name,
                text: 'The deployment has successfully been deleted.'
              })
            }
          },
          {
            type: 'separator'
          },
          {
            label: 'Created on ' + created.format('MMMM Do YYYY') + ', ' + created.format('h:mm a'),
            enabled: false
          }
        ]
      }
    }

    const generatedMenu = await menuItems(app, tray, config, deployments)
    const menu = Menu.buildFromTemplate(generatedMenu)

    tray.setContextMenu(menu)
  } else {
    tray.setHighlightMode('never')
    let isHighlighted = false

    const toggleHighlight = () => {
      tray.setHighlightMode(isHighlighted ? 'never' : 'always')
      isHighlighted = !isHighlighted
    }

    const tutorial = onboarding()

    const events = [
      'closed',
      'minimize',
      'restore'
    ]

    // Hide window instead of closing it
    tutorial.on('close', event => {
      if (tutorial.forceClose) {
        return
      }

      toggleHighlight()
      tutorial.hide()

      event.preventDefault()
    })

    // Register window event listeners
    for (const event of events) {
      tutorial.on(event, toggleHighlight)
    }

    // When quitting the app, force close the tutorial
    app.on('before-quit', () => {
      tutorial.forceClose = true
    })

    tray.on('click', event => {
      // If window open and not focused, bring it to focus
      if (tutorial.isVisible() && !tutorial.isFocused()) {
        tutorial.focus()
        return
      }

      // Show or hide onboarding window
      if (isHighlighted) {
        tutorial.hide()
      } else {
        tutorial.show()
        isHighlighted = false
      }

      // Toggle highlight mode
      toggleHighlight()

      // Don't open the menu
      event.preventDefault()
    })

    let submenuShown = false

    // Ability to close the app when logged out
    tray.on('right-click', async event => {
      const menu = Menu.buildFromTemplate([
        {
          label: process.platform === 'darwin' ? `Quit ${app.getName()}` : 'Quit',
          click: app.quit,
          role: 'quit'
        }
      ])

      // Toggle highlight mode if tutorial isn't visible
      if (!tutorial.isVisible()) {
        toggleHighlight()
      }

      // Toggle submenu
      tray.popUpContextMenu(submenuShown ? null : menu)
      submenuShown = !submenuShown

      event.preventDefault()
    })
  }
})
