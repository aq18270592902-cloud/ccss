' 竞足预测汇总 - 静默启动本地服务（无黑窗）
' 开机自启：本文件的快捷方式/副本放在启动文件夹即可
Set ws = CreateObject("Wscript.Shell")
ws.Run "cmd /c D:\nodejs\node.exe " & Chr(34) & "c:\Users\aq\Desktop\ccss\server.js" & Chr(34), 0, False
