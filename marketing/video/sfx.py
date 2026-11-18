import numpy as np, subprocess
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile
SR=48000; D=15.0; N=int(SR*D); rng=np.random.default_rng(3)
t=np.arange(N)/SR
def env(n,a,r): x=np.ones(n); a=int(a*SR); r=int(r*SR); x[:a]=np.linspace(0,1,a) if a else 1; x[-r:]*=np.linspace(1,0,r)**2 if r else 1; return x
def lp(x,f,o=2): return sosfilt(butter(o,f,'low',fs=SR,output='sos'),x)
def hp(x,f,o=2): return sosfilt(butter(o,f,'high',fs=SR,output='sos'),x)
def bp(x,a,b): return sosfilt(butter(2,[a,b],'band',fs=SR,output='sos'),x)
L=np.zeros(N);Rr=np.zeros(N)
def add(sig,at,g=1.0,pan=0.0):
    i=int(at*SR); j=min(N,i+len(sig)); s=sig[:j-i]*g
    L[i:j]+=s*np.sqrt((1-pan)/2); Rr[i:j]+=s*np.sqrt((1+pan)/2)
def saw(f,tt): return 2*((f*tt)%1)-1
# --- pad: Am drone, opens over time
pad=np.zeros(N)
for f in [55,82.41,110,130.81,164.81]:
    for d in (-0.15,0.15): pad+=saw(f*(1+d/100),t)*(0.5 if f<100 else 0.25)
cut=300+1800*np.clip(t/14,0,1)**2
# block-wise variable LPF
out=np.zeros(N);B=2400
for k in range(0,N,B):
    out[k:k+B]=lp(pad[k:k+B]+0,cut[k],2)
pad=lp(out,4000)*0.09*np.clip(t/1.0,0,1)*(1-0.85*np.clip((t-13.5)/0.15,0,1)*(t<14.2))
add(pad,0,1.0,-0.2); add(np.roll(pad,900),0,1.0,0.2)
# --- city ambience (wind+distant)
amb=lp(rng.standard_normal(N),500)*0.05*(1+0.4*np.sin(2*np.pi*0.13*t)); add(amb,0,1,-0.3); add(np.roll(amb,7000),0,1,0.3)
# --- sub kick
def kick(g=1.0):
    n=int(.5*SR);tt=np.arange(n)/SR;f=45+120*np.exp(-tt*30);ph=2*np.pi*np.cumsum(f)/SR
    return np.sin(ph)*np.exp(-tt*7)*g
def hat():
    n=int(.06*SR);return hp(rng.standard_normal(n),7000)*np.exp(-np.arange(n)/SR*70)*.25
bpm=110;beat=60/bpm
for k in range(64):
    tb=3.3+k*beat
    if tb>13.5:break
    add(kick(0.9 if k%2==0 else 0.5),tb)
    add(hat(),tb+beat/2,0.6,0.3)
# --- clock tick scene C
for k in range(14):
    tb=7.45+k*0.27
    if tb>10.9:break
    n=int(.03*SR);tk=bp(rng.standard_normal(n),2500,6000)*np.exp(-np.arange(n)/SR*200)
    add(tk,tb,0.5,0.4 if k%2 else -0.4)
# --- whoosh
def whoosh(dur=0.7,up=True):
    n=int(dur*SR);x=rng.standard_normal(n);y=np.zeros(n);B=512
    for k in range(0,n,B):
        p=k/n; f=(300+5000*p**2) if up else (5000-4500*p)
        y[k:k+B]=bp(x[k:k+B],max(80,f*0.6),min(20000,f*1.4))
    e=np.sin(np.pi*np.linspace(0,1,n))**2
    return lp(y,9000)*e*0.9
def impact(g=1.0):
    n=int(1.6*SR);tt=np.arange(n)/SR
    boom=np.sin(2*np.pi*np.cumsum(35+80*np.exp(-tt*12))/SR)*np.exp(-tt*3)
    crack=lp(rng.standard_normal(n),3000)*np.exp(-tt*18)*0.6
    return (boom+crack)*g
for tr in (3.3,7.4,11.1):
    w=whoosh(0.7); add(w,tr-0.6,0.5,-0.5); add(whoosh(0.7)[::-1]*0.4,tr-0.6,1,0.5); add(impact(0.6),tr)
# tile swooshes
for i in range(3): add(whoosh(0.4),7.5+i*.55-0.15,0.35,(i-1)*.7); add(kick(0.4),7.5+i*.55+0.25,1,(i-1)*.5)
# --- coin chimes along route
def ru(x): u=np.clip((x-3.9)/3.0,0,1); return 1-(1-u)**3
tt=np.linspace(3.9,6.9,3000);rr=ru(tt)
def chime(f,g=1):
    n=int(1.2*SR);x=np.arange(n)/SR
    s=sum(np.sin(2*np.pi*f*h*x)*a*np.exp(-x*(4+h*2)) for h,a in [(1,1),(2.76,.5),(5.4,.25),(8.9,.12)])
    return s*g*0.18
notes=[880,987.8,1046.5,1174.7,1318.5,1568,1760]
for i in range(1,8):
    at=i/8; tm=tt[np.argmax(rr>=at)]; add(chime(notes[i-1]),tm,1,(i-4)/4)
    for k in range(3): add(chime(notes[i-1]*2,0.35),tm+0.08+k*0.06,1,-(i-4)/4)
# number counter ticks
for k in np.arange(3.6,6.6,0.07): n=int(.01*SR); add(bp(rng.standard_normal(n),3000,8000)*np.hanning(n)*.08,k,1,0.2)
# --- letters pop ticks
for a,txt in [(0.2,"NOUVEAU LIVREUR ?"),(11.2,"BIENTÔT.")]:
    for ci in range(len(txt)): n=int(.02*SR); add(bp(rng.standard_normal(n),1500,5000)*np.hanning(n)*.12,a+ci*.03,1,(ci%3-1)*.4)
# --- riser + rattle
n=int(2.4*SR);x=np.arange(n)/SR;p=x/x[-1]
riser=(bp(rng.standard_normal(n),400,9000)*p**2*0.5+np.sin(2*np.pi*np.cumsum(200+1200*p**3)/SR)*p**3*0.15)
add(riser,11.2,0.8)
rat=np.zeros(n);
for k in np.arange(0,2.4,0.035):
    m=int(.02*SR);i=int(k*SR)
    if i+m<n: rat[i:i+m]+=bp(rng.standard_normal(m),200,1200)*np.hanning(m)*(k/2.4)**2
add(rat,11.3,1.2)
# --- box open: impact + shimmer
add(impact(1.3),13.6); add(whoosh(0.6)*0.6,13.55)
n=int(2.5*SR);x=np.arange(n)/SR
shim=sum(np.sin(2*np.pi*f*x+np.sin(2*np.pi*5*x)*2)*np.exp(-x*1.4) for f in [880,1318.5,1760,2637])*0.06
add(shim,13.62,1,-0.3);add(np.roll(shim,1200),13.62,1,0.3)
# end sub tail
add(np.sin(2*np.pi*36*np.arange(int(1.4*SR))/SR)*np.exp(-np.arange(int(1.4*SR))/SR*2.2)*.5,13.6)
# --- reverb (synthetic IR)
irn=int(2.2*SR);ir=rng.standard_normal(irn)*np.exp(-np.arange(irn)/SR*3.0);ir=lp(ir,6000)
wetL=fftconvolve(L,ir)[:N]*0.012;wetR=fftconvolve(Rr,np.roll(ir,311))[:N]*0.012
L+=wetL;Rr+=wetR
# --- voice
VO=[(0,.3),(1,1.9),(2,3.4),(3,7.6),(4,11.1)]
voice=np.zeros(N)
for i,at in VO:
    subprocess.run(['ffmpeg','-v','0','-y','-i',f'vo/{i}.mp3','-af','highpass=f=90,equalizer=f=3000:t=q:w=1:g=3,acompressor=threshold=-20dB:ratio=4:makeup=4','-ar',str(SR),'-ac','1',f'vo/{i}.wav'])
    _,v=wavfile.read(f'vo/{i}.wav');v=v.astype(float)/32768
    a=int(at*SR);voice[a:a+len(v)]+=v[:N-a]
# ducking
envv=np.convolve(np.abs(voice),np.ones(2400)/2400,'same');duck=1-0.45*np.clip(envv*12,0,1)
duck=np.convolve(duck,np.ones(4800)/4800,'same')
L*=duck;Rr*=duck
vr=np.convolve(voice,ir[:int(.6*SR)]*0.5,'full')[:N]*0.01
L+=voice*0.95+vr; Rr+=voice*0.95+np.roll(vr,200)
fade=np.clip((D-t)/0.5,0,1);L*=fade;Rr*=fade
m=np.tanh(np.stack([L,Rr],1)*1.2);m/=np.max(np.abs(m))*1.05
wavfile.write('mix.wav',SR,(m*32767).astype(np.int16))
print('ok')
