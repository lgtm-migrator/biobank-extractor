'use strict'

const Application = require('spectron').Application
const electron = require('electron')
const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
const path = require('path')
const fs = require('fs')

chai.should()
chai.use(chaiAsPromised)

const timeout = process.env.CI ? 30000 : 10000

describe('biobank-extractor', function () {
    this.timeout(timeout)

    let app

    const getUserDataPath = function () {
        const productName = require('../package').productName
        switch (process.platform) {
            case 'darwin':
                return path.join(process.env.HOME, 'Library', 'Application Support', productName)
            case 'win32':
                return path.join(process.env.APPDATA, productName)
            case 'freebsd':
            case 'linux':
            case 'sunos':
                return path.join(process.env.HOME, '.config', productName)
            default:
                throw new Error(`Unknown userDataPath path for platform ${process.platform}`)
        }
    }

    const removeStoredPreferences = function () {
        const userDataPath = getUserDataPath()
        try {
            fs.unlinkSync(path.join(userDataPath, 'Settings'))
        } catch (error) {
            if (error.code !== 'ENOENT') throw error
        }
    }

    const setupApp = function (app) {
        app.client.addCommand('dismissDropPage', function () {
            return this.isVisible('.js-nav').then(function (navVisible) {
                if (!navVisible) {
                    return this.click('button[id="get-started"]').pause(500)
                }
            })
        })

        app.client.addCommand('selectSection', function (section) {
            return this.click('button[data-section="' + section + '"]').pause(100)
                .waitForVisible('#' + section + '-section')
        })

        app.client.addCommand('expandDemos', function () {
            return this.execute(function () {
                for (let subsection of document.querySelectorAll('.subsection-wrapper')) {
                    subsection.classList.add('is-open')
                }
            })
        })

        app.client.addCommand('collapseDemos', function () {
            return this.execute(function () {
                for (let subsection of document.querySelectorAll('.subsection-wrapper')) {
                    subsection.classList.remove('is-open')
                }
            })
        })

        app.client.addCommand('auditSectionAccessibility', function (section) {
            const options = {
                ignoreRules: ['AX_COLOR_01', 'AX_TITLE_01']
            }
            return this.selectSection(section)
                .expandDemos()
                .auditAccessibility(options).then(function (audit) {
                    if (audit.failed) {
                        throw Error(section + ' section failed accessibility audit\n' + audit.message)
                    }
                })
        })

        chaiAsPromised.transferPromiseness = app.transferPromiseness
        return app.client.waitUntilWindowLoaded()
    }

    const startApp = function () {
        app = new Application({
            path: electron,
            args: [
                path.join(__dirname, '..')
            ],
            waitTimeout: timeout
        })

        return app.start().then(setupApp)
    }

    const restartApp = function () {
        return app.restart().then(setupApp)
    }

    before(function () {
        removeStoredPreferences()
        return startApp()
    })

    after(function () {
        if (app && app.isRunning()) {
            return app.stop()
        }
    })

    it('checks hardcoded path for userData is correct', function () {
        return app.client.execute(function () {
            return require('electron').remote.app.getPath('userData')
        }).then(function (result) {
            return result.value
        }).should.eventually.equal(getUserDataPath())
    })

    it('opens a window displaying the drop page', function () {
        return app.client.getWindowCount().should.eventually.equal(1)
            .browserWindow.isMinimized().should.eventually.be.false
            .browserWindow.isDevToolsOpened().should.eventually.be.false
            .browserWindow.isVisible().should.eventually.be.true
            .browserWindow.isFocused().should.eventually.be.true
            .browserWindow.getBounds().should.eventually.have.property('width').and.be.above(0)
            .browserWindow.getBounds().should.eventually.have.property('height').and.be.above(0)
            .browserWindow.getTitle().should.eventually.equal('UK Biobank Extractor')
            .waitForVisible('#drop-modal').should.eventually.be.true
            .isVisible('.js-nav').should.eventually.be.false
            .click('button[id="get-started"]').pause(500)
            .isVisible('#drop-modal').should.eventually.be.false
            .isVisible('.js-nav').should.eventually.be.true
    })

    describe('when clicking on a section from the nav bar', function () {
        it('it shows the selected section in the main area', function () {
            return app.client.dismissDropPage()
                .selectSection('windows')
                .isExisting('button.is-selected[data-section="windows"]').should.eventually.be.true
                .isVisible('#pdf-section').should.eventually.be.false
                .selectSection('pdf')
                .isVisible('#windows-section').should.eventually.be.false
                .isExisting('button.is-selected[data-section="windows"]').should.eventually.be.false
                .isExisting('button.is-selected[data-section="pdf"]').should.eventually.be.true
        })
    })

    describe('when a subsection title is clicked', function () {
        it('it expands the subsection content', function () {
            let onlyFirstVisible = Array(30).fill(false)
            onlyFirstVisible[0] = true

            return app.client.dismissDropPage()
                .collapseDemos()
                .selectSection('windows')
                .click('.js-container-target')
                .waitForVisible('.subsection-box')
                .isVisible('.subsection-box').should.eventually.deep.equal(onlyFirstVisible)
        })
    })

    describe('when the app is restarted after use', function () {
        it('it launches at last visted section & subsection', function () {
            let onlyFirstVisible = Array(30).fill(false)
            onlyFirstVisible[0] = true

            return app.client.waitForVisible('#windows-section')
                .then(restartApp)
                .then(function () {
                    return app.client.waitForVisible('#windows-section')
                        .isVisible('#windows-section').should.eventually.be.true
                        .isVisible('.subsection-box').should.eventually.deep.equal(onlyFirstVisible)
                })
        })
    })

    it('does not contain any accessibility warnings or errors', function () {
        return app.client.dismissDropPage()
            .auditSectionAccessibility('windows')
            .auditSectionAccessibility('crash-hang')
            .auditSectionAccessibility('menus')
            .auditSectionAccessibility('shortcuts')
            .auditSectionAccessibility('ex-links-file-manager')
            .auditSectionAccessibility('notifications')
            .auditSectionAccessibility('dialogs')
            .auditSectionAccessibility('tray')
            .auditSectionAccessibility('announcements')
            .auditSectionAccessibility('file-select')
            .auditSectionAccessibility('summary')
            .auditSectionAccessibility('extract')
            .auditSectionAccessibility('pdf')
            .auditSectionAccessibility('desktop-capturer')
    })
})