/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'
import FloatingLogo from './FloatingLogo'
import FloatingMascotHint from './FloatingMascotHint'
import './i18n'
import QuickChat from './QuickChat'
import { applyDocumentTheme } from './theme'
import './styles.css'

const [windowRoute, windowQuery = ''] = window.location.hash.slice(1).split('?')
const initialTheme = new URLSearchParams(windowQuery).get('theme')
const isQuickWindow = windowRoute === 'quick'
const isFloatingLogoWindow = windowRoute === 'floating-logo'
const isFloatingHintWindow = windowRoute === 'floating-hint'

applyDocumentTheme(
  initialTheme === 'auto' || initialTheme === 'light' || initialTheme === 'dark' || initialTheme === 'gold'
    ? initialTheme
    : 'auto',
  true
)

document.documentElement.classList.toggle('quick-window-document', isQuickWindow)
document.documentElement.classList.toggle('floating-logo-document', isFloatingLogoWindow)
document.documentElement.classList.toggle('floating-hint-document', isFloatingHintWindow)
document.body.classList.toggle('quick-window-body', isQuickWindow)
document.body.classList.toggle('floating-logo-body', isFloatingLogoWindow)
document.body.classList.toggle('floating-hint-body', isFloatingHintWindow)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isFloatingHintWindow ? <FloatingMascotHint /> : isFloatingLogoWindow ? <FloatingLogo /> : isQuickWindow ? <QuickChat /> : <App />}
  </React.StrictMode>
)
