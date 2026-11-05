"""Resting dinosaur: room-sized low body, soft dorsal spikes and short right tail.
Front is -y; rear cover is the broad planar +y cut. Dimensions in mm.
"""
from body_parts import broad_flat_back, feature_report, flat_sole, grow, size, superblob, surface_x, surface_z
ROOM = dict(width=104.4, depth=39.7, height=36.3)
WIDTH, DEPTH, HEIGHT = 110.4, 64.0, 36.9
SHOULDER = max(0.0, (HEIGHT - ROOM['height'] - 1.0) / HEIGHT)
body = superblob(WIDTH, DEPTH, HEIGHT, roundness=4.0, top=2.5, shoulder=0.04)
print('core:', list(size(body)))
added, skipped = [], []
for x, h, w, name in [(-39,12,8,'spike 1'),(-14,15,8.5,'spike 2'),(12,14,8.5,'spike 3'),(36,11,7.5,'spike 4')]:
    body = grow(body, name, (x, 0.03*x, HEIGHT - 0.5),
                [(0,w,6),(7,6,4.5),(h,2.5,2.0)],
                added, skipped, direction=(0,0,1), flare=1.25, roundness=2.0, tip=False)

z = 10.0
body = grow(body, 'tail or head bump', (surface_x(body,0,z,side=1),0,z),
            [(0,10,12),(7,8,9),(14,5.3,6),(18,2.5,3)],
            added, skipped, direction=(1,0,0.12), side=(0,0,1), flare=1.3)
if not body.is_valid:
    raise ValueError('invalid union '+str(feature_report()))
print('before sole', body.is_valid, len(body.solids()))
body = flat_sole(body)
print('after sole', body.is_valid, len(body.solids()))
body = body.clean()
from build123d import export_step, import_step
export_step(body, 'smooth_intermediate.step')
body = import_step('smooth_intermediate.step')
body, back_y = broad_flat_back(body, share=0.65)
print('added:', added, 'skipped:', skipped, 'size:', size(body), 'back cut:', back_y)
print(feature_report())