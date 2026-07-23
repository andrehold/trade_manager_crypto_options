import React from 'react'
import { createRoot } from 'react-dom/client'
import { RootRouter } from './RootRouter'
import './styles/utilities.css'

const root = createRoot(document.getElementById('root')!)
root.render(<RootRouter />)
