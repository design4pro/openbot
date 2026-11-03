"""Synthetic X11 input receiver. It emits counts, never key content."""
import json
import os
import select
import sys
from Xlib import X, Xatom, display, protocol

connection = display.Display()
root = connection.screen().root
window = root.create_window(0, 0, 640, 480, 0, connection.screen().root_depth,
                            X.InputOutput, X.CopyFromParent,
                            background_pixel=connection.screen().white_pixel,
                            event_mask=X.KeyPressMask | X.KeyReleaseMask | X.StructureNotifyMask)
window.set_wm_name("OpenBot native input proof")
window.change_property(connection.intern_atom("_NET_WM_PID"), Xatom.CARDINAL, 32, [os.getpid()])
root.change_property(connection.intern_atom("_NET_CLIENT_LIST"), Xatom.WINDOW, 32, [window.id])
root.change_property(connection.intern_atom("_NET_CLIENT_LIST_STACKING"), Xatom.WINDOW, 32, [window.id])
root.change_property(connection.intern_atom("_NET_ACTIVE_WINDOW"), Xatom.WINDOW, 32, [window.id])
window.map()
window.set_input_focus(X.RevertToParent, X.CurrentTime)
connection.sync()
print(json.dumps({"kind": "ready", "pid": os.getpid(), "windowId": window.id}), flush=True)
count = 0
private_count = 0
private = False
fence_atom = connection.intern_atom("_OPENBOT_INPUT_FENCE")
while True:
    while connection.pending_events():
        event = connection.next_event()
        if event.type in (X.KeyPress, X.KeyRelease):
            count += 1
            if private:
                private_count += 1
            if count == 1:
                print(json.dumps({"kind": "first_key"}), flush=True)
        elif event.type == X.ClientMessage and event.client_type == fence_atom:
            print(json.dumps({"kind": "fence", "count": count, "privateCount": private_count}), flush=True)
    readable, _, _ = select.select([connection.fileno(), sys.stdin], [], [])
    if sys.stdin in readable:
        command = sys.stdin.readline().strip()
        if command == "stop" or command == "":
            break
        if command == "private":
            private = True
        elif command == "public":
            private = False
        window.send_event(protocol.event.ClientMessage(window=window, client_type=fence_atom,
                                                        data=(32, [0, 0, 0, 0, 0])))
        connection.sync()
window.destroy()
connection.sync()
connection.close()
