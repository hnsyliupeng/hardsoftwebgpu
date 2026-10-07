%% Global setup

close all; clear all; clc
warning('off','all')

% Fonts
fig_w = 300; fig_h = 300; fig_s = 2;
ax_font_size = 9*fig_s;

% Figures
set(0,'DefaultTextFontname', 'CMU Sans Serif' )
set(0,'DefaultAxesFontName', 'CMU Sans Serif' )
map = brewermap(9,'Set1');

% save path
export_fig = false;

%%

fig = figure(1); clf; hold on;

set(findobj(gcf,'type','axes'),'FontSize',ax_font_size,'LineWidth',1);
set(gcf,'color','w');
set(fig, 'Units', 'inches');
width = 1.65;
height = 2.5;
set(fig, 'Position', [0, 0, width*fig_s, height*fig_s]);


t = tiledlayout(5,1);
t.TileSpacing = 'tight';
t.Padding = 'tight';  

loc = './cv/bend/';
files = {'zerozero','fivedeg','tendeg','fifdeg','twendeg'};
names = {'0^\circ', '5^\circ', '10^\circ',...
    '15^\circ','20^\circ'};
% names = {'0', '5', '10',...
%     '15','20'};


loc2 = './cv/extend';
files2 = {'minus13mm','minus6p5mm','plus6p5mm','plus13mm','plus22p5mm'};
names2 = {'-13 mm', '-6.5 mm', '+6.5 mm',...
    '+13 mm','+22.5 mm'};

for it = 1:5
    
    fileloc = [loc, files{it}, '.txt'];
    
    [t1, inp, t2, outp] = readdata(fileloc);

n= 8000;
nexttile;
plot(t1(:), inp(:),'color','k', 'linewidth',3); hold on;
plot(t2(:), outp(:),'linestyle','--','color',map(1,:),'linewidth', 3); 
del{it} = outp(:)-inp(:);

[pks,locs] = findpeaks(inp);
[pks2,locs2] = findpeaks(outp);
di(it) = locs2(end)-locs(end);
wv(it) = locs2(end)-locs2(end-1);   
percent = di(it)/wv(it);
xlim([0, 0.7])
ylim([-180,180])
yticks([-100,0,100])
title(' ',FontSize=ax_font_size)
yticklabels({'-100','','100'})

set(findobj(gcf,'type','axes'),'FontSize',ax_font_size,'LineWidth',1);
if it ~= 5
    set(gca,'XTickLabel',[]);
end
end

% export fig
if export_fig
    exportgraphics(gcf,'../figures/cv/theta.png','Resolution',300*fig_s)
end

%%

fig=figure(2); clf; hold on;

set(findobj(gcf,'type','axes'),'FontSize',ax_font_size,'LineWidth',1);
set(gcf,'color','w');
set(fig, 'Units', 'inches');
width = 1.65;
height = 2.5;
set(fig, 'Position', [0, 0, width*fig_s, height*fig_s]);

t = tiledlayout(5,1);
t.TileSpacing = 'tight';
t.Padding = 'tight';  

for it = 1:5
    
    fileloc = [loc2, files2{it}, '.txt'];

    data = readmatrix(fileloc,'NumHeaderLines',0 );
        t1 = data(:,1);
    inp = data(:,2)*(360/1024);
   	outp = data(:,3)*(360/1024);
    
    inp = wrapTo180(inp-inp(find(inp >= 180,1)));
    outp = wrapTo180(outp-outp(find(outp >= 180,1)));
    
    %outp = wrapTo180(outp - outp(1));
    %inp = wrapTo180(inp - inp(1));

n= 8000;
nexttile;
plot(t1(:)-t1(1), inp(:),'color','k', 'linewidth',3); hold on;
plot(t1(:)-t1(1), outp(:),'linestyle','--','color',map(1,:),'linewidth', 3); 


title(' ',FontSize=ax_font_size)

xlim([0, 1.3])
ylim([-180,180])
yticks([-100,0,100])
yticklabels({'-100','','100'})

set(findobj(gcf,'type','axes'),'FontSize',ax_font_size,'LineWidth',1);
if it ~= 5
    set(gca,'XTickLabel',[]);
end
end 

% export fig
if export_fig
    exportgraphics(gcf,'../figures/cv/length.png','Resolution',300*fig_s)
end

%%
function [t1, inp, t2, outp] = readdata(loc)

    data = readmatrix(loc,'NumHeaderLines',0 );
    
    t1 = data(:,1);
    inp = data(:,2);
    t2 = data(:,3);
    outp = data(:,4);

end