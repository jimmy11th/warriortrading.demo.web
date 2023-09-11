import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import PermanentDrawerLeft from './components/siderbar/SiderBar'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'WarriorTrading Chatroom',
  description: '',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className} style={{display: 'flex', flexDirection:'row', justifyContent:'start'}}>
        <PermanentDrawerLeft />
        {children}</body>
    </html>
  )
}
